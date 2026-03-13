import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { put } from "@vercel/blob";
import { Sandbox } from "e2b";
import BlobFile from "@/models/BlobFile";
import {
  createAttachmentDescriptor,
  getAttachmentCategory,
  getFileExtension,
  normalizeMimeType,
} from "@/lib/shared/attachments";
import {
  assertE2BApiKey,
  getConfiguredE2BTemplateRef,
  getConfiguredE2BTemplateVersion,
} from "@/lib/server/sandbox/e2bConfig";

const DEFAULT_SANDBOX_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_SANDBOX_WORKDIR_ROOT = "/home/user/vectaix";
const PARSER_SCRIPT_LOCAL_PATH = path.join(process.cwd(), "scripts", "e2b-template", "parser", "parse_attachment.py");
const PARSER_SCRIPT_REMOTE_PATH = "/home/user/vectaix/bin/parse_attachment.py";
const MAX_VISUAL_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_CHARS = 8000;

function clipText(text, maxLength = MAX_COMMAND_OUTPUT_CHARS) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (!Number.isFinite(maxLength) || maxLength <= 0 || trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function sanitizeSegment(value, fallback = "item") {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || fallback;
}

function normalizeBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return Buffer.alloc(0);
}

export function getE2BTemplateVersion() {
  return getConfiguredE2BTemplateVersion();
}

export function getSandboxWorkdir(conversationId) {
  const root = process.env.E2B_SANDBOX_WORKDIR_ROOT || DEFAULT_SANDBOX_WORKDIR_ROOT;
  return `${root}/sessions/${sanitizeSegment(String(conversationId || "detached"), "detached")}`;
}

function assertE2BConfigured() {
  assertE2BApiKey();
}

async function collectPaginatorItems(source) {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  if (typeof source.nextItems === "function") {
    const items = [];
    while (true) {
      const batch = await source.nextItems();
      if (!Array.isArray(batch) || batch.length === 0) break;
      items.push(...batch);
      if (batch.length < 100) break;
    }
    return items;
  }
  return [];
}

async function listSandboxesSafe() {
  if (typeof Sandbox.list !== "function") return [];
  const listed = await Sandbox.list();
  return collectPaginatorItems(listed);
}

function buildMetadata({ userId, conversationId, purpose = "agent" }) {
  return {
    app: "vectaix",
    userId: String(userId || ""),
    conversationId: String(conversationId || ""),
    purpose,
  };
}

function metadataMatches(source, target) {
  if (!source || typeof source !== "object") return false;
  return Object.entries(target).every(([key, value]) => String(source?.[key] || "") === String(value || ""));
}

async function ensureBootstrapFiles(sandbox, workdir) {
  const parserScript = await fs.readFile(PARSER_SCRIPT_LOCAL_PATH, "utf8");
  await sandbox.files.write(PARSER_SCRIPT_REMOTE_PATH, parserScript);
  await sandbox.commands.run(`mkdir -p ${JSON.stringify(path.posix.dirname(PARSER_SCRIPT_REMOTE_PATH))} ${JSON.stringify(workdir)} ${JSON.stringify(`${workdir}/uploads`)} ${JSON.stringify(`${workdir}/artifacts`)} ${JSON.stringify(`${workdir}/tasks`)}`);
  await sandbox.commands.run(`chmod +x ${JSON.stringify(PARSER_SCRIPT_REMOTE_PATH)}`);
}

function buildSessionPayload({ sandbox, sandboxId, workdir, status = "running", latestCommand = null, pendingCommand = null }) {
  return {
    sandboxId: sandboxId || sandbox?.sandboxId || "",
    template: getConfiguredE2BTemplateRef(),
    templateVersion: getE2BTemplateVersion(),
    status,
    workdir,
    lastConnectedAt: new Date(),
    requiresApproval: false,
    canResume: Boolean(pendingCommand),
    latestCommand,
    pendingCommand,
  };
}

async function connectById(sandboxId) {
  if (!sandboxId || typeof Sandbox.connect !== "function") return null;
  return Sandbox.connect(sandboxId);
}

export async function createOrConnectSandbox({
  userId,
  conversationId,
  purpose = "agent",
  existingSession = null,
  allowInternetAccess = true,
}) {
  assertE2BConfigured();

  const metadata = buildMetadata({ userId, conversationId, purpose });
  const workdir = getSandboxWorkdir(conversationId || `${purpose}-${userId}`);
  let sandbox = null;
  let sandboxId = existingSession?.sandboxId || "";

  if (sandboxId) {
    try {
      sandbox = await connectById(sandboxId);
    } catch {
      sandbox = null;
    }
  }

  if (!sandbox) {
    const sandboxes = await listSandboxesSafe();
    const matched = sandboxes.find((item) => metadataMatches(item?.metadata, metadata));
    if (matched?.sandboxId || matched?.id) {
      sandboxId = matched.sandboxId || matched.id;
      sandbox = await connectById(sandboxId);
    }
  }

  if (!sandbox) {
    sandbox = await Sandbox.create(getConfiguredE2BTemplateRef(), {
      timeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS,
      metadata,
      envs: {
        VECTAIX_SANDBOX_APP: "vectaix",
        VECTAIX_TEMPLATE_VERSION: getE2BTemplateVersion(),
      },
      secure: true,
      allowInternetAccess,
    });
    sandboxId = sandbox?.sandboxId || sandboxId;
    await ensureBootstrapFiles(sandbox, workdir);
  } else {
    await ensureBootstrapFiles(sandbox, workdir);
  }

  return {
    sandbox,
    session: buildSessionPayload({
      sandbox,
      sandboxId,
      workdir,
      status: "running",
      latestCommand: existingSession?.latestCommand || null,
      pendingCommand: existingSession?.pendingCommand || null,
    }),
  };
}

function encodeShell(value) {
  return JSON.stringify(String(value || ""));
}

function buildParserLimitFlags(limits) {
  if (!limits || typeof limits !== "object") return "";
  const pairs = [
    ["maxPages", "--max-pages"],
    ["maxSheets", "--max-sheets"],
    ["maxRowsPerSheet", "--max-rows-per-sheet"],
    ["maxCols", "--max-cols"],
    ["maxCells", "--max-cells"],
  ];
  return pairs
    .map(([key, flag]) => {
      const value = Number(limits?.[key]);
      return Number.isFinite(value) && value > 0 ? `${flag} ${encodeShell(value)}` : "";
    })
    .filter(Boolean)
    .join(" ");
}

function normalizeCommandResult(result, extra = {}) {
  return {
    command: extra.command || "",
    cwd: extra.cwd || "",
    background: extra.background === true,
    exitCode: Number.isFinite(result?.exitCode) ? result.exitCode : null,
    pid: Number.isFinite(result?.pid) ? result.pid : null,
    stdout: clipText(typeof result?.stdout === "string" ? result.stdout : ""),
    stderr: clipText(typeof result?.stderr === "string" ? result.stderr : ""),
    completed: extra.background === true ? false : true,
    startedAt: extra.startedAt || new Date().toISOString(),
    finishedAt: extra.background === true ? null : new Date().toISOString(),
  };
}

export async function runSandboxCommand({
  sandbox,
  session,
  command,
  cwd,
  background = false,
}) {
  const workdir = cwd || session?.workdir || getSandboxWorkdir("detached");
  const startedAt = new Date().toISOString();
  if (background) {
    const taskId = crypto.randomUUID();
    const taskDir = `${session?.workdir || workdir}/tasks/${taskId}`;
    const stdoutPath = `${taskDir}/stdout.log`;
    const stderrPath = `${taskDir}/stderr.log`;
    const exitCodePath = `${taskDir}/exit.code`;
    const wrapped = `mkdir -p ${encodeShell(taskDir)} && bash -lc ${encodeShell(`${command} > ${stdoutPath} 2> ${stderrPath}; status=$?; echo $status > ${exitCodePath}`)}`;
    const handle = await sandbox.commands.run(wrapped, { cwd: workdir, background: true });
    const latestCommand = normalizeCommandResult(handle, {
      command,
      cwd: workdir,
      background: true,
      startedAt,
    });
    return {
      result: latestCommand,
      pendingCommand: {
        pid: Number.isFinite(handle?.pid) ? handle.pid : null,
        command,
        status: "running",
        startedAt: new Date(),
        stdoutPath,
        stderrPath,
        exitCodePath,
      },
    };
  }

  const result = await sandbox.commands.run(command, { cwd: workdir });
  return {
    result: normalizeCommandResult(result, { command, cwd: workdir, background: false, startedAt }),
    pendingCommand: null,
  };
}

async function listCommandsSafe(sandbox) {
  if (!sandbox?.commands || typeof sandbox.commands.list !== "function") return [];
  const listed = await sandbox.commands.list();
  return collectPaginatorItems(listed);
}

export async function inspectPendingCommand({ sandbox, pendingCommand }) {
  if (!pendingCommand?.pid) {
    return { status: "missing", result: null };
  }

  const runningCommands = await listCommandsSafe(sandbox);
  const stillRunning = runningCommands.some((item) => Number(item?.pid) === Number(pendingCommand.pid));
  if (stillRunning) {
    return { status: "running", result: null };
  }

  const [stdoutRaw, stderrRaw, exitCodeRaw] = await Promise.all([
    sandbox.files.read(pendingCommand.stdoutPath).catch(() => ""),
    sandbox.files.read(pendingCommand.stderrPath).catch(() => ""),
    sandbox.files.read(pendingCommand.exitCodePath).catch(() => ""),
  ]);

  return {
    status: "completed",
    result: {
      command: pendingCommand.command || "",
      cwd: "",
      background: true,
      pid: pendingCommand.pid,
      stdout: clipText(typeof stdoutRaw === "string" ? stdoutRaw : normalizeBuffer(stdoutRaw).toString("utf8")),
      stderr: clipText(typeof stderrRaw === "string" ? stderrRaw : normalizeBuffer(stderrRaw).toString("utf8")),
      exitCode: Number.parseInt(typeof exitCodeRaw === "string" ? exitCodeRaw.trim() : normalizeBuffer(exitCodeRaw).toString("utf8").trim(), 10) || 0,
      completed: true,
      startedAt: pendingCommand.startedAt ? new Date(pendingCommand.startedAt).toISOString() : null,
      finishedAt: new Date().toISOString(),
    },
  };
}

export async function writeSandboxFile({ sandbox, remotePath, content }) {
  await sandbox.files.write(remotePath, content);
  return remotePath;
}

export async function readSandboxFile({ sandbox, remotePath }) {
  const raw = await sandbox.files.read(remotePath);
  if (typeof raw === "string") {
    return { text: raw, buffer: Buffer.from(raw, "utf8") };
  }
  const buffer = normalizeBuffer(raw);
  return { text: buffer.toString("utf8"), buffer };
}

async function saveVisualAssetToBlob({
  userId,
  conversationId,
  fileBaseName,
  visualAsset,
}) {
  const mimeType = normalizeMimeType(visualAsset?.mimeType) || "image/png";
  const extension = getFileExtension(visualAsset?.name || "") || (mimeType === "image/jpeg" ? "jpg" : "png");
  const base64Data = typeof visualAsset?.dataBase64 === "string" ? visualAsset.dataBase64 : "";
  if (!base64Data) return null;
  const buffer = Buffer.from(base64Data, "base64");
  if (buffer.length === 0 || buffer.length > MAX_VISUAL_ASSET_BYTES) return null;
  const pathname = `document-assets/${String(userId)}/${sanitizeSegment(String(conversationId || "detached"), "detached")}/${sanitizeSegment(fileBaseName, "asset")}-${crypto.randomUUID()}.${extension}`;
  const blob = await put(pathname, buffer, {
    access: "public",
    addRandomSuffix: false,
    contentType: mimeType,
  });
  return {
    url: blob.url,
    mimeType,
    size: buffer.length,
    label: typeof visualAsset?.label === "string" ? visualAsset.label : "视觉内容",
    sourceType: typeof visualAsset?.sourceType === "string" ? visualAsset.sourceType : "embedded-image",
    page: Number.isFinite(visualAsset?.page) ? visualAsset.page : null,
    sheet: typeof visualAsset?.sheet === "string" ? visualAsset.sheet : null,
  };
}

function buildRemoteInputPath({ conversationId, originalName }) {
  return `${getSandboxWorkdir(conversationId)}/uploads/${sanitizeSegment(originalName, "file")}`;
}

function buildRemoteOutputPath({ conversationId, originalName }) {
  const baseName = sanitizeSegment(originalName.replace(/\.[^.]+$/, ""), "file");
  return `${getSandboxWorkdir(conversationId)}/artifacts/${baseName}.json`;
}

export async function ensureBlobFileInSandbox({
  userId,
  conversationId,
  blobFile,
  session,
}) {
  const sandboxConversationId = conversationId || `blob-${blobFile?._id}`;
  const { sandbox, session: resolvedSession } = await createOrConnectSandbox({
    userId,
    conversationId: sandboxConversationId,
    purpose: "agent",
    existingSession: session,
    allowInternetAccess: false,
  });

  const originalName = blobFile?.originalName || blobFile?.pathname || "file";
  const inputPath = buildRemoteInputPath({ conversationId: sandboxConversationId, originalName });
  const response = await fetch(blobFile.url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("文件下载失败");
  }

  await writeSandboxFile({
    sandbox,
    remotePath: inputPath,
    content: Buffer.from(await response.arrayBuffer()),
  });

  return {
    sandbox,
    session: {
      ...resolvedSession,
      latestCommand: resolvedSession?.latestCommand || null,
    },
    sandboxPath: inputPath,
  };
}

export async function parseAttachmentInSandbox({
  userId,
  conversationId,
  blobFile,
  session,
  limits = null,
}) {
  const sandboxConversationId = conversationId || `parse-${blobFile?._id}`;
  const ensured = await ensureBlobFileInSandbox({
    userId,
    conversationId: sandboxConversationId,
    blobFile,
    session,
  });
  const sandbox = ensured.sandbox;
  const resolvedSession = ensured.session;

  const originalName = blobFile?.originalName || blobFile?.pathname || "file";
  const extension = getFileExtension(originalName);
  const inputPath = ensured.sandboxPath;
  const outputPath = buildRemoteOutputPath({ conversationId: conversationId || `parse-${blobFile?._id}`, originalName });
  const parserLimitFlags = buildParserLimitFlags(limits);
  const parseCommand = `python3 ${encodeShell(PARSER_SCRIPT_REMOTE_PATH)} --input ${encodeShell(inputPath)} --output ${encodeShell(outputPath)} --original-name ${encodeShell(originalName)} --extension ${encodeShell(extension)} --mime-type ${encodeShell(blobFile?.mimeType || "")}${parserLimitFlags ? ` ${parserLimitFlags}` : ""}`;
  const { result } = await runSandboxCommand({
    sandbox,
    session: resolvedSession,
    command: parseCommand,
    cwd: resolvedSession.workdir,
    background: false,
  });
  if (Number.isFinite(result?.exitCode) && result.exitCode !== 0) {
    throw new Error(result.stderr || "沙盒解析失败");
  }

  const parsedOutput = await readSandboxFile({ sandbox, remotePath: outputPath });
  const payload = JSON.parse(parsedOutput.text || "{}");
  const visualAssets = [];
  const fileBaseName = originalName.replace(/\.[^.]+$/, "") || "file";
  for (const visualAsset of Array.isArray(payload.visualAssets) ? payload.visualAssets : []) {
    const saved = await saveVisualAssetToBlob({
      userId,
      conversationId,
      fileBaseName,
      visualAsset,
    });
    if (saved) visualAssets.push(saved);
  }

  return {
    session: {
      ...resolvedSession,
      latestCommand: result,
    },
    commandResult: result,
    sandboxPath: inputPath,
    parseArtifacts: [{
      path: outputPath,
      type: "parse-json",
    }],
    prepared: {
      file: buildPreparedFileDescriptor({
        url: blobFile.url,
        name: originalName,
        mimeType: blobFile.mimeType,
        size: blobFile.size,
        extension,
        category: getAttachmentCategory({ extension, mimeType: blobFile.mimeType }),
        formatSummary: payload.formatSummary || "",
        visualAssets,
      }),
      extractedText: typeof payload.text === "string" ? payload.text : "",
      structuredText: typeof payload.structuredText === "string" ? payload.structuredText : "",
      formatSummary: typeof payload.formatSummary === "string" ? payload.formatSummary : "",
      visualAssets,
      pageCount: Number.isFinite(payload?.stats?.pageCount) ? payload.stats.pageCount : null,
      sheetCount: Number.isFinite(payload?.stats?.sheetCount) ? payload.stats.sheetCount : null,
      rowCount: Number.isFinite(payload?.stats?.rowCount) ? payload.stats.rowCount : null,
    },
  };
}

function buildPreparedFileDescriptor({ url, name, mimeType, size, extension, category, formatSummary, visualAssets }) {
  const descriptor = createAttachmentDescriptor({ url, name, mimeType, size, extension, category });
  const assets = Array.isArray(visualAssets)
    ? visualAssets.filter((item) => item?.url && item?.mimeType)
    : [];
  return {
    ...descriptor,
    formatSummary: clipText(formatSummary || "", 1000),
    visualAssetCount: assets.length,
    visualAssets: assets,
  };
}

export async function downloadSandboxArtifactToBlob({
  sandbox,
  remotePath,
  userId,
  conversationId,
  runId,
  title,
  mimeType = "text/plain",
  extension = "txt",
}) {
  const { buffer } = await readSandboxFile({ sandbox, remotePath });
  const safeTitle = sanitizeSegment(title || path.posix.basename(remotePath), "artifact");
  const pathname = `agent/${String(userId)}/${String(conversationId || "detached")}/${String(runId || "manual")}/${safeTitle}.${extension}`;
  const blob = await put(pathname, buffer, {
    access: "public",
    addRandomSuffix: true,
    contentType: mimeType,
  });
  await BlobFile.findOneAndUpdate(
    { url: blob.url },
    {
      $setOnInsert: {
        userId,
        url: blob.url,
        pathname: blob.pathname,
        originalName: `${safeTitle}.${extension}`,
        mimeType,
        size: buffer.length,
        extension,
        category: "text",
        kind: "agent-artifact",
        parseStatus: "ready",
        parseProvider: "e2b",
        parseTemplateVersion: getE2BTemplateVersion(),
        extractedText: buffer.toString("utf8"),
        extractedChars: buffer.length,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
  return {
    url: blob.url,
    pathname: blob.pathname,
    title: safeTitle,
    mimeType,
    extension,
    size: buffer.length,
  };
}

export async function pauseSandboxSession(session) {
  if (!session?.sandboxId) return;
  try {
    const sandbox = await connectById(session.sandboxId);
    if (sandbox && typeof sandbox.pause === "function") {
      await sandbox.pause();
    }
  } catch {
    // ignore cleanup failure
  }
}

export async function killSandboxSession(session) {
  if (!session?.sandboxId) return;
  try {
    const sandbox = await connectById(session.sandboxId);
    if (sandbox && typeof sandbox.kill === "function") {
      await sandbox.kill();
      return;
    }
    if (sandbox && typeof sandbox.pause === "function") {
      await sandbox.pause();
    }
  } catch {
    // ignore cleanup failure
  }
}
