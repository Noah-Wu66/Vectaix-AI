import crypto from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { put } from "@vercel/blob";
import { Sandbox, Snapshot } from "@vercel/sandbox";
import BlobFile from "@/models/BlobFile";
import {
  createAttachmentDescriptor,
  getAttachmentCategory,
  getFileExtension,
  normalizeMimeType,
} from "@/lib/shared/attachments";

const DEFAULT_SANDBOX_TIMEOUT_MS = 20 * 60 * 1000;
const SANDBOX_ROOT = "/vercel/sandbox/vectaix";
const AGENT_RUNTIME = "node24";
const PARSER_RUNTIME = "python3.13";
const PARSER_SCRIPT_LOCAL_PATH = path.join(process.cwd(), "scripts", "sandbox", "parse_attachment.py");
const PARSER_SCRIPT_REMOTE_PATH = `${SANDBOX_ROOT}/bin/parse_attachment.py`;
const PARSER_BOOTSTRAP_MARKER = `${SANDBOX_ROOT}/bootstrap/python.ready`;
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

function encodeShell(value) {
  return JSON.stringify(String(value || ""));
}

function buildParserLimitFlags(limits) {
  if (!limits || typeof limits !== "object") return [];
  const pairs = [
    ["maxPages", "--max-pages"],
    ["maxSheets", "--max-sheets"],
    ["maxRowsPerSheet", "--max-rows-per-sheet"],
    ["maxCols", "--max-cols"],
    ["maxCells", "--max-cells"],
  ];
  return pairs.flatMap(([key, flag]) => {
    const value = Number(limits?.[key]);
    return Number.isFinite(value) && value > 0 ? [flag, String(value)] : [];
  });
}

function getRuntimeForPurpose(purpose = "agent") {
  return purpose === "parser" ? PARSER_RUNTIME : AGENT_RUNTIME;
}

function getNetworkPolicy(allowInternetAccess = true) {
  return allowInternetAccess ? "allow-all" : "deny-all";
}

function hasMethod(target, methodName) {
  return Boolean(target && typeof target?.[methodName] === "function");
}

async function applyRequestedNetworkPolicy(sandbox, requestedNetworkPolicy) {
  if (!sandbox || !requestedNetworkPolicy) return false;
  if (!hasMethod(sandbox, "updateNetworkPolicy")) return false;
  await sandbox.updateNetworkPolicy(requestedNetworkPolicy);
  return true;
}

export function getSandboxProvider() {
  return "vercel-sandbox";
}

export function getSandboxRuntime(purpose = "agent") {
  return getRuntimeForPurpose(purpose);
}

export function getSandboxWorkdir(conversationId, purpose = "agent") {
  return `${SANDBOX_ROOT}/sessions/${purpose}/${sanitizeSegment(String(conversationId || "detached"), "detached")}`;
}

function buildSessionPayload({
  sandbox,
  sandboxId,
  snapshotId = "",
  workdir,
  runtime,
  status = "running",
  latestCommand = null,
  pendingCommand = null,
}) {
  return {
    provider: getSandboxProvider(),
    runtime,
    sandboxId: sandboxId || sandbox?.sandboxId || "",
    snapshotId: typeof snapshotId === "string" ? snapshotId : "",
    status,
    workdir,
    lastConnectedAt: new Date(),
    requiresApproval: false,
    canResume: Boolean(pendingCommand),
    latestCommand,
    pendingCommand,
  };
}

function normalizeCommandResult(command, extra = {}) {
  return {
    command: extra.command || "",
    cwd: extra.cwd || command?.cwd || "",
    background: extra.background === true,
    exitCode: Number.isFinite(command?.exitCode) ? command.exitCode : null,
    cmdId: typeof command?.cmdId === "string" ? command.cmdId : "",
    stdout: clipText(typeof extra.stdout === "string" ? extra.stdout : ""),
    stderr: clipText(typeof extra.stderr === "string" ? extra.stderr : ""),
    completed: extra.background === true ? false : true,
    startedAt: extra.startedAt || new Date().toISOString(),
    finishedAt: extra.background === true ? null : new Date().toISOString(),
  };
}

async function connectById(sandboxId) {
  if (!sandboxId) return null;
  try {
    const sandbox = await Sandbox.get({ sandboxId });
    if (!sandbox || ["stopped", "failed"].includes(sandbox.status)) return null;
    return sandbox;
  } catch {
    return null;
  }
}

async function readStreamToBuffer(stream) {
  if (!stream) return Buffer.alloc(0);
  const response = new Response(stream);
  return Buffer.from(await response.arrayBuffer());
}

async function readSandboxPathBuffer(sandbox, remotePath) {
  const stream = await sandbox.readFile({ path: remotePath });
  if (!stream) return Buffer.alloc(0);
  return readStreamToBuffer(stream);
}

async function ensureBaseDirectories(sandbox, workdir) {
  const command = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      `mkdir -p ${encodeShell(path.posix.dirname(PARSER_SCRIPT_REMOTE_PATH))} ${encodeShell(workdir)} ${encodeShell(`${workdir}/uploads`)} ${encodeShell(`${workdir}/artifacts`)} ${encodeShell(`${workdir}/tasks`)}`,
    ],
  });
  if (command.exitCode !== 0) {
    const stderr = await command.stderr().catch(() => "");
    throw new Error(stderr || "初始化沙盒目录失败");
  }
}

async function ensureParserBootstrap(sandbox) {
  const existing = await sandbox.readFile({ path: PARSER_BOOTSTRAP_MARKER }).catch(() => null);
  if (existing) return;

  const antiwordCheck = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", "command -v antiword >/dev/null 2>&1"],
  });
  if (antiwordCheck.exitCode !== 0) {
    const installAntiword = await sandbox.runCommand({
      cmd: "dnf",
      args: ["install", "-y", "antiword"],
      sudo: true,
    });
    if (installAntiword.exitCode !== 0) {
      const stderr = await installAntiword.stderr().catch(() => "");
      console.warn("antiword 安装失败，旧版 DOC 解析将不可用", stderr || "no stderr");
    }
  }

  const installPythonDeps = await sandbox.runCommand({
    cmd: "python3",
    args: ["-m", "pip", "install", "--quiet", "pypdf", "python-docx", "openpyxl", "xlrd==1.2.0"],
  });
  if (installPythonDeps.exitCode !== 0) {
    const stderr = await installPythonDeps.stderr().catch(() => "");
    throw new Error(stderr || "安装 Python 解析依赖失败");
  }

  const parserScript = await readFile(PARSER_SCRIPT_LOCAL_PATH);
  await sandbox.writeFiles([
    { path: PARSER_SCRIPT_REMOTE_PATH, content: parserScript },
    { path: PARSER_BOOTSTRAP_MARKER, content: Buffer.from(new Date().toISOString(), "utf8") },
  ]);
}

async function ensureSandboxReady({ sandbox, workdir, purpose }) {
  await ensureBaseDirectories(sandbox, workdir);
  if (purpose === "parser") {
    await ensureParserBootstrap(sandbox);
  }
}

export async function createOrConnectSandbox({
  userId,
  conversationId,
  purpose = "agent",
  existingSession = null,
  allowInternetAccess = true,
}) {
  const runtime = existingSession?.runtime || getRuntimeForPurpose(purpose);
  const requestedNetworkPolicy = getNetworkPolicy(allowInternetAccess);
  const needsBootstrapInternet = purpose === "parser";
  const createNetworkPolicy = needsBootstrapInternet ? "allow-all" : requestedNetworkPolicy;
  const sessionPurpose = runtime === PARSER_RUNTIME ? "parser" : "agent";
  const workdir = existingSession?.workdir || getSandboxWorkdir(conversationId || `${purpose}-${userId}`, sessionPurpose);
  let sandbox = null;
  let sandboxId = existingSession?.sandboxId || "";
  let snapshotId = existingSession?.snapshotId || "";

  if (sandboxId) {
    sandbox = await connectById(sandboxId);
  }

  if (!sandbox && snapshotId) {
    try {
      sandbox = await Sandbox.create({
        source: {
          type: "snapshot",
          snapshotId,
        },
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        resources: { vcpus: 1 },
        networkPolicy: requestedNetworkPolicy,
      });
      sandboxId = sandbox.sandboxId;
      snapshotId = "";
    } catch {
      sandbox = null;
      snapshotId = "";
    }
  }

  if (!sandbox) {
    sandbox = await Sandbox.create({
      runtime,
      timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
      resources: { vcpus: 1 },
      networkPolicy: createNetworkPolicy,
    });
    sandboxId = sandbox.sandboxId;
  }

  await ensureSandboxReady({ sandbox, workdir, purpose });
  if (createNetworkPolicy !== requestedNetworkPolicy || !sandbox?.networkPolicy || sandbox.networkPolicy !== requestedNetworkPolicy) {
    await applyRequestedNetworkPolicy(sandbox, requestedNetworkPolicy).catch(() => false);
  }
  snapshotId = "";

  return {
    sandbox,
    session: buildSessionPayload({
      sandbox,
      sandboxId,
      snapshotId,
      workdir,
      runtime,
      status: sandbox.status || "running",
      latestCommand: existingSession?.latestCommand || null,
      pendingCommand: existingSession?.pendingCommand || null,
    }),
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
    const wrapped = `mkdir -p ${encodeShell(taskDir)} && ${command} > ${encodeShell(stdoutPath)} 2> ${encodeShell(stderrPath)}; status=$?; echo $status > ${encodeShell(exitCodePath)}`;
    const handle = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", wrapped],
      cwd: workdir,
      detached: true,
    });
    const latestCommand = normalizeCommandResult(handle, {
      command,
      cwd: workdir,
      background: true,
      startedAt,
    });
    return {
      result: latestCommand,
      pendingCommand: {
        cmdId: typeof handle?.cmdId === "string" ? handle.cmdId : "",
        command,
        status: "running",
        startedAt: new Date(),
        stdoutPath,
        stderrPath,
        exitCodePath,
      },
    };
  }

  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", command],
    cwd: workdir,
  });
  const stdout = await result.stdout().catch(() => "");
  const stderr = await result.stderr().catch(() => "");
  return {
    result: normalizeCommandResult(result, {
      command,
      cwd: workdir,
      background: false,
      startedAt,
      stdout,
      stderr,
    }),
    pendingCommand: null,
  };
}

export async function inspectPendingCommand({ sandbox, pendingCommand }) {
  if (!pendingCommand?.cmdId || !pendingCommand?.exitCodePath) {
    return { status: "missing", result: null };
  }

  const exitCodeBuffer = await readSandboxPathBuffer(sandbox, pendingCommand.exitCodePath).catch(() => Buffer.alloc(0));
  if (!exitCodeBuffer.length) {
    return { status: "running", result: null };
  }

  const [stdoutBuffer, stderrBuffer] = await Promise.all([
    readSandboxPathBuffer(sandbox, pendingCommand.stdoutPath).catch(() => Buffer.alloc(0)),
    readSandboxPathBuffer(sandbox, pendingCommand.stderrPath).catch(() => Buffer.alloc(0)),
  ]);

  return {
    status: "completed",
    result: {
      command: pendingCommand.command || "",
      cwd: "",
      background: true,
      cmdId: pendingCommand.cmdId,
      stdout: clipText(stdoutBuffer.toString("utf8")),
      stderr: clipText(stderrBuffer.toString("utf8")),
      exitCode: Number.parseInt(exitCodeBuffer.toString("utf8").trim(), 10) || 0,
      completed: true,
      startedAt: pendingCommand.startedAt ? new Date(pendingCommand.startedAt).toISOString() : null,
      finishedAt: new Date().toISOString(),
    },
  };
}

export async function writeSandboxFile({ sandbox, remotePath, content }) {
  await sandbox.writeFiles([{ path: remotePath, content: normalizeBuffer(content) }]);
  return remotePath;
}

export async function readSandboxFile({ sandbox, remotePath }) {
  const buffer = await readSandboxPathBuffer(sandbox, remotePath);
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

function buildRemoteInputPath({ conversationId, originalName, purpose = "agent", workdir = "" }) {
  const baseDir = workdir || getSandboxWorkdir(conversationId, purpose);
  return `${baseDir}/uploads/${sanitizeSegment(originalName, "file")}`;
}

function buildRemoteOutputPath({ conversationId, originalName, workdir = "" }) {
  const baseName = sanitizeSegment(originalName.replace(/\.[^.]+$/, ""), "file");
  const baseDir = workdir || getSandboxWorkdir(conversationId, "parser");
  return `${baseDir}/artifacts/${baseName}.json`;
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
    allowInternetAccess: true,
  });

  const originalName = blobFile?.originalName || blobFile?.pathname || "file";
  const inputPath = buildRemoteInputPath({ conversationId: sandboxConversationId, originalName, purpose: "agent" });
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
  limits = null,
  existingSession = null,
}) {
  const sandboxConversationId = conversationId || `parse-${blobFile?._id}`;
  const { sandbox, session } = await createOrConnectSandbox({
    userId,
    conversationId: sandboxConversationId,
    purpose: "parser",
    existingSession,
    allowInternetAccess: false,
  });
  const shouldKeepAlive = Boolean(conversationId || existingSession?.sandboxId);

  try {
    const originalName = blobFile?.originalName || blobFile?.pathname || "file";
    const extension = getFileExtension(originalName);
    const inputPath = buildRemoteInputPath({
      conversationId: sandboxConversationId,
      originalName,
      purpose: "parser",
      workdir: session?.workdir || "",
    });
    const outputPath = buildRemoteOutputPath({
      conversationId: sandboxConversationId,
      originalName,
      workdir: session?.workdir || "",
    });
    const response = await fetch(blobFile.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("文件下载失败");
    }

    await writeSandboxFile({
      sandbox,
      remotePath: inputPath,
      content: Buffer.from(await response.arrayBuffer()),
    });

    const parseArgs = [
      PARSER_SCRIPT_REMOTE_PATH,
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--original-name",
      originalName,
      "--extension",
      extension,
      "--mime-type",
      blobFile?.mimeType || "",
      ...buildParserLimitFlags(limits),
    ];

    const command = await sandbox.runCommand({
      cmd: "python3",
      args: parseArgs,
      cwd: session.workdir,
    });
    const stdout = await command.stdout().catch(() => "");
    const stderr = await command.stderr().catch(() => "");
    const result = normalizeCommandResult(command, {
      command: `python3 ${encodeShell(PARSER_SCRIPT_REMOTE_PATH)}`,
      cwd: session.workdir,
      stdout,
      stderr,
    });
    if (command.exitCode !== 0) {
      throw new Error(stderr || "沙盒解析失败");
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
        ...session,
        latestCommand: result,
      },
      commandResult: result,
      sandboxPath: inputPath,
      parseArtifacts: [{ path: outputPath, type: "parse-json" }],
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
        cellCount: Number.isFinite(payload?.stats?.cellCount) ? payload.stats.cellCount : null,
        maxCols: Number.isFinite(payload?.stats?.maxCols) ? payload.stats.maxCols : null,
      },
    };
  } finally {
    if (!shouldKeepAlive) {
      await sandbox.stop().catch(() => {});
    }
  }
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

export async function pauseSandboxSession(session, { preserveState = false } = {}) {
  if (!session?.sandboxId) return;
  const sandbox = await connectById(session.sandboxId);
  if (sandbox) {
    if (preserveState) {
      if (hasMethod(sandbox, "snapshot")) {
        const snapshot = await sandbox.snapshot().catch(() => null);
        if (snapshot?.snapshotId) {
          return {
            ...session,
            snapshotId: snapshot.snapshotId,
            status: "paused",
            lastConnectedAt: new Date(),
          };
        }
      }
      return {
        ...(session || {}),
        status: sandbox.status || session?.status || "running",
        lastConnectedAt: new Date(),
      };
    }
    await sandbox.stop().catch(() => {});
  }
  return {
    ...(session || {}),
    snapshotId: "",
    status: "stopped",
    lastConnectedAt: new Date(),
  };
}

export async function killSandboxSession(session) {
  if (session?.sandboxId) {
    const sandbox = await connectById(session.sandboxId);
    if (sandbox) {
      await sandbox.stop().catch(() => {});
    }
  }
  if (session?.snapshotId && hasMethod(Snapshot, "get")) {
    try {
      const snapshot = await Snapshot.get({ snapshotId: session.snapshotId });
      if (hasMethod(snapshot, "delete")) {
        await snapshot.delete();
      }
    } catch {
      // ignore cleanup failure
    }
  }
}
