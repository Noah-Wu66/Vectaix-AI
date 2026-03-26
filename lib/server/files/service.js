import BlobFile from "@/models/BlobFile";
import {
  createAttachmentDescriptor,
  getAttachmentCategory,
  getAttachmentLimits,
  getFileExtension,
  isDocumentAttachment,
  isSupportedDocumentExtension,
  normalizeMimeType,
} from "@/lib/shared/attachments";
import {
  ensureBlobFileInSandbox,
  parseAttachmentInSandbox,
} from "@/lib/server/sandbox/vercelSandbox";

const BLOB_ALLOWED_DOMAINS = [
  "blob.vercel-storage.com",
  "public.blob.vercel-storage.com",
];

const FILE_PARSE_VERSION = 3;

function isBlobUrlAllowed(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname.toLowerCase();
    return BLOB_ALLOWED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function normalizeExtractedText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeVisualAssets(visualAssets) {
  if (!Array.isArray(visualAssets)) return [];
  return visualAssets
    .filter((item) => item?.url && item?.mimeType)
    .slice(0, 6)
    .map((item, index) => ({
      url: item.url,
      mimeType: normalizeMimeType(item.mimeType) || "image/png",
      size: Number(item.size) || 0,
      label: typeof item.label === "string" && item.label ? item.label : `视觉内容 ${index + 1}`,
      sourceType: typeof item.sourceType === "string" && item.sourceType ? item.sourceType : "embedded-image",
      page: Number.isFinite(item.page) ? item.page : null,
      sheet: typeof item.sheet === "string" && item.sheet ? item.sheet : null,
    }));
}

function buildPreparedFileDescriptor({ url, name, mimeType, size, extension, category, formatSummary, visualAssets }) {
  const descriptor = createAttachmentDescriptor({ url, name, mimeType, size, extension, category });
  const assets = normalizeVisualAssets(visualAssets);
  return {
    ...descriptor,
    formatSummary: normalizeExtractedText(formatSummary || ""),
    visualAssetCount: assets.length,
    visualAssets: assets,
  };
}

function pickVisualSummaryText(visualAssets) {
  const assets = Array.isArray(visualAssets) ? visualAssets : [];
  if (assets.length === 0) return "";
  const labels = assets
    .slice(0, 4)
    .map((item) => item?.label || item?.sourceType || "图片")
    .filter(Boolean);
  const labelText = labels.length > 0 ? `：${labels.join("、")}` : "";
  return `已额外提取 ${assets.length} 个视觉内容${labelText}`;
}

export async function loadBlobFileByUser({ userId, url }) {
  if (!userId || !isBlobUrlAllowed(url)) return null;
  return BlobFile.findOne({ userId, url });
}

function isReadyBlobFile(blobFile) {
  return blobFile?.parseStatus === "ready"
    && typeof blobFile?.extractedText === "string"
    && blobFile.extractedText.trim()
    && Number(blobFile?.parseVersion) >= FILE_PARSE_VERSION
    && blobFile?.parseProvider === "vercel-sandbox";
}

function buildPreparedFromBlob(blobFile, { sandboxPath = null } = {}) {
  const originalName = blobFile.originalName || blobFile.pathname || "file";
  const extension = blobFile.extension || getFileExtension(originalName);
  const mimeType = normalizeMimeType(blobFile.mimeType);
  const category = blobFile.category || getAttachmentCategory({ extension, mimeType });
  const visualAssets = normalizeVisualAssets(blobFile.visualAssets);
  return {
    file: buildPreparedFileDescriptor({
      url: blobFile.url,
      name: originalName,
      mimeType,
      size: blobFile.size,
      extension,
      category,
      formatSummary: blobFile.formatSummary,
      visualAssets,
    }),
    extractedText: blobFile.extractedText,
    structuredText: blobFile.structuredText || blobFile.extractedText,
    formatSummary: blobFile.formatSummary || "",
    visualAssets,
    visualAssetCount: Number(blobFile.visualAssetCount) || visualAssets.length,
    sandboxPath: typeof sandboxPath === "string" && sandboxPath.trim() ? sandboxPath.trim() : null,
    pageCount: Number.isFinite(blobFile.pageCount) ? blobFile.pageCount : null,
    sheetCount: Number.isFinite(blobFile.sheetCount) ? blobFile.sheetCount : null,
    rowCount: Number.isFinite(blobFile.rowCount) ? blobFile.rowCount : null,
    cellCount: Number.isFinite(blobFile.cellCount) ? blobFile.cellCount : null,
    maxCols: Number.isFinite(blobFile.maxCols) ? blobFile.maxCols : null,
  };
}

function assertBlobWithinLimits(blobFile, category) {
  const limits = getAttachmentLimits(category);
  const size = Number(blobFile?.size) || 0;
  if (limits?.maxBytes && size > limits.maxBytes) {
    throw new Error("文件大小超过系统限制");
  }
  return limits;
}

function assertPreparedWithinLimits() {
  // 结构限制已移除，仅保留 maxBytes + maxChars
}

export async function prepareDocumentAttachment({
  userId,
  url,
  conversationId = null,
  sandboxSession = null,
  signal,
}) {
  if (!isBlobUrlAllowed(url)) {
    throw new Error("文件地址不合法");
  }

  const blobFile = await loadBlobFileByUser({ userId, url });
  if (!blobFile) {
    throw new Error("文件不存在或无权限访问");
  }

  const originalName = blobFile.originalName || blobFile.pathname || "file";
  const extension = getFileExtension(originalName);
  const mimeType = normalizeMimeType(blobFile.mimeType);
  const category = getAttachmentCategory({ extension, mimeType });
  const limits = assertBlobWithinLimits(blobFile, category);

  if (!extension || !isSupportedDocumentExtension(extension) || !category || !isDocumentAttachment({ extension, mimeType })) {
    throw new Error("该文件不是可解析的文档附件");
  }

  const shouldEnsureSandboxCopy = Boolean(conversationId || sandboxSession?.sandboxId);
  const shouldKeepParseSandbox = Boolean(conversationId || sandboxSession?.sandboxId);

  if (isReadyBlobFile(blobFile)) {
    const prepared = buildPreparedFromBlob(blobFile);
    assertPreparedWithinLimits(prepared, category, limits);
    if (!shouldEnsureSandboxCopy) {
      return {
        prepared,
        sandboxSession,
        commandResult: null,
      };
    }
    const ensured = await ensureBlobFileInSandbox({
      userId,
      conversationId: conversationId || `blob-${blobFile._id}`,
      blobFile,
      session: sandboxSession,
      signal,
    });
    return {
      prepared: {
        ...prepared,
        sandboxPath: ensured.sandboxPath || null,
      },
      sandboxSession: ensured.session || sandboxSession,
      commandResult: null,
    };
  }

  const parseStartedAt = new Date();
  await BlobFile.updateOne(
    { _id: blobFile._id },
    {
      $set: {
        parseStatus: "processing",
        parseProvider: "vercel-sandbox",
        parseStartedAt,
        parseFinishedAt: null,
        errorMessage: null,
      },
    }
  );

  try {
    const parsed = await parseAttachmentInSandbox({
      userId,
      conversationId: conversationId || `blob-${blobFile._id}`,
      blobFile,
      limits,
      existingSession: sandboxSession,
      keepAlive: shouldKeepParseSandbox,
      signal,
    });
    const prepared = parsed.prepared;
    assertPreparedWithinLimits(prepared, category, limits);
    const extractedText = normalizeExtractedText(prepared.extractedText || "");
    const structuredText = normalizeExtractedText(prepared.structuredText || prepared.extractedText || "");
    const formatSummary = normalizeExtractedText(prepared.formatSummary || "");
    const visualAssets = normalizeVisualAssets(prepared.visualAssets);

    await BlobFile.updateOne(
      { _id: blobFile._id },
      {
        $set: {
          category,
          extension,
          parseStatus: "ready",
          parseProvider: "vercel-sandbox",
          extractedText,
          structuredText,
          formatSummary,
          visualAssets,
          visualAssetCount: visualAssets.length,
          parseVersion: FILE_PARSE_VERSION,
          extractedChars: extractedText.length,
          pageCount: Number.isFinite(prepared.pageCount) ? prepared.pageCount : null,
          sheetCount: Number.isFinite(prepared.sheetCount) ? prepared.sheetCount : null,
          rowCount: Number.isFinite(prepared.rowCount) ? prepared.rowCount : null,
          cellCount: Number.isFinite(prepared.cellCount) ? prepared.cellCount : null,
          maxCols: Number.isFinite(prepared.maxCols) ? prepared.maxCols : null,
          sandboxPath: null,
          parseArtifacts: Array.isArray(parsed.parseArtifacts) ? parsed.parseArtifacts : [],
          parseJob: parsed.commandResult || null,
          parseStartedAt,
          parseFinishedAt: new Date(),
          errorMessage: null,
        },
      }
    );

    let nextSandboxSession = sandboxSession;
    let nextSandboxPath = null;
    if (shouldEnsureSandboxCopy) {
      if (parsed?.session?.sandboxId) {
        nextSandboxSession = parsed.session;
        nextSandboxPath = parsed.sandboxPath || null;
      } else {
        const ensured = await ensureBlobFileInSandbox({
          userId,
          conversationId: conversationId || `blob-${blobFile._id}`,
          blobFile,
          session: sandboxSession,
          signal,
        });
        nextSandboxSession = ensured.session || sandboxSession;
        nextSandboxPath = ensured.sandboxPath || null;
      }
    }

    return {
      prepared: {
        ...prepared,
        extractedText,
        structuredText,
        formatSummary,
        visualAssets,
        visualAssetCount: visualAssets.length,
        sandboxPath: nextSandboxPath,
        cellCount: Number.isFinite(prepared.cellCount) ? prepared.cellCount : null,
        maxCols: Number.isFinite(prepared.maxCols) ? prepared.maxCols : null,
      },
      sandboxSession: nextSandboxSession,
      commandResult: parsed.commandResult || null,
    };
  } catch (error) {
    await BlobFile.updateOne(
      { _id: blobFile._id },
      {
        $set: {
          category,
          extension,
          parseStatus: "failed",
          parseProvider: "vercel-sandbox",
          parseFinishedAt: new Date(),
          extractedText: null,
          structuredText: null,
          formatSummary: null,
          visualAssets: [],
          visualAssetCount: 0,
          extractedChars: 0,
          pageCount: null,
          sheetCount: null,
          rowCount: null,
          parseArtifacts: [],
          parseJob: null,
          errorMessage: error?.message || "文件解析失败",
        },
      }
    );
    throw error;
  }
}

export async function getPreparedAttachmentTextsByUrls(urls, { userId } = {}) {
  if (!Array.isArray(urls) || urls.length === 0) return new Map();
  const query = {
    url: { $in: urls.filter((item) => typeof item === "string" && item) },
    parseStatus: "ready",
  };
  if (userId) query.userId = userId;

  const docs = await BlobFile.find(query)
    .select("url originalName pathname mimeType size extension category extractedText structuredText formatSummary visualAssets visualAssetCount pageCount sheetCount rowCount cellCount maxCols parseProvider parseVersion")
    .lean();

  const map = new Map();
  for (const doc of docs) {
    if (!isReadyBlobFile(doc)) continue;
    const prepared = buildPreparedFromBlob(doc);
    map.set(doc.url, prepared);
  }
  return map;
}

export function buildAttachmentTextBlock(fileData, extractedText) {
  const descriptor = createAttachmentDescriptor(fileData || {});
  const formatSummary = normalizeExtractedText(fileData?.formatSummary || "");
  const visualCount = Number(fileData?.visualAssetCount) || (Array.isArray(fileData?.visualAssets) ? fileData.visualAssets.length : 0);
  const visualSummary = pickVisualSummaryText(fileData?.visualAssets);
  const meta = [
    descriptor.name ? `文件名：${descriptor.name}` : "",
    descriptor.extension ? `扩展名：${descriptor.extension}` : "",
    descriptor.mimeType ? `类型：${descriptor.mimeType}` : "",
    formatSummary ? `结构说明：${formatSummary}` : "",
    visualCount > 0 ? `视觉内容：${visualSummary || `已提取 ${visualCount} 个视觉内容`}` : "",
  ].filter(Boolean);

  return [
    "[附件开始]",
    ...meta,
    "以下是附件提取出的结构化内容：",
    normalizeExtractedText(extractedText),
    "[附件结束]",
  ].join("\n");
}
