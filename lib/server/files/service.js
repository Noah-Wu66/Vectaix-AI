import { promises as fs } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
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

const BLOB_ALLOWED_DOMAINS = [
  "blob.vercel-storage.com",
  "public.blob.vercel-storage.com",
];

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

function sanitizeFileName(name) {
  if (typeof name !== "string" || !name.trim()) return "file";
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
}

function normalizeExtractedText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assertTextLength(text, category) {
  const limits = getAttachmentLimits(category);
  if (!limits) return;
  if (limits.maxChars && text.length > limits.maxChars) {
    throw new Error("文件文本内容过长，已超过系统限制");
  }
}

function assertBinarySignature(buffer, extension) {
  if (!(buffer instanceof Uint8Array) || buffer.length === 0) {
    throw new Error("文件为空或无法读取");
  }

  if (extension === "pdf") {
    const header = Buffer.from(buffer.slice(0, 4)).toString("utf8");
    if (header !== "%PDF") throw new Error("PDF 文件格式无效");
    return;
  }

  if (extension === "docx" || extension === "xlsx") {
    const header = Buffer.from(buffer.slice(0, 2)).toString("hex");
    if (header !== "504b") throw new Error("Office 文件格式无效");
    return;
  }

  if (extension === "doc" || extension === "xls") {
    const header = Buffer.from(buffer.slice(0, 8)).toString("hex");
    if (!header.startsWith("d0cf11e0a1b11ae1")) {
      throw new Error("旧版 Office 文件格式无效");
    }
  }
}

function decodeUtf8Text(buffer) {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const normalized = normalizeExtractedText(text);
  if (!normalized) {
    throw new Error("文件没有可读取的文本内容");
  }
  return normalized;
}

async function parsePdfBuffer(buffer, limits) {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  const result = await pdfParse(buffer);
  if (!result?.text?.trim()) {
    throw new Error("PDF 没有可提取的文本内容");
  }
  if (limits?.maxPages && Number(result.numpages) > limits.maxPages) {
    throw new Error(`PDF 页数超过限制，最多支持 ${limits.maxPages} 页`);
  }
  return {
    text: normalizeExtractedText(result.text),
    pageCount: Number.isFinite(result.numpages) ? result.numpages : null,
  };
}

async function parseDocxBuffer(buffer) {
  const mammothModule = await import("mammoth");
  const mammoth = mammothModule.default || mammothModule;
  const result = await mammoth.extractRawText({ buffer });
  const text = normalizeExtractedText(result?.value || "");
  if (!text) throw new Error("DOCX 没有可提取的文本内容");
  return { text };
}

async function parseDocBuffer(buffer, extension) {
  const module = await import("word-extractor");
  const WordExtractor = module.default || module;
  const tempPath = path.join(os.tmpdir(), `vectaix-${crypto.randomUUID()}.${extension}`);
  await fs.writeFile(tempPath, buffer);
  try {
    const extractor = new WordExtractor();
    const document = await extractor.extract(tempPath);
    const bodyText = typeof document?.getBody === "function" ? document.getBody() : "";
    const text = normalizeExtractedText(bodyText);
    if (!text) throw new Error("DOC 没有可提取的文本内容");
    return { text };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

async function parseSpreadsheetBuffer(buffer, extension, limits) {
  const xlsxModule = await import("xlsx");
  const XLSX = xlsxModule.default || xlsxModule;
  const workbook = XLSX.read(buffer, { type: "buffer", dense: true });
  const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
  if (!sheetNames.length) throw new Error("表格文件没有可读取的工作表");
  if (limits?.maxSheets && sheetNames.length > limits.maxSheets) {
    throw new Error(`工作表数量超过限制，最多支持 ${limits.maxSheets} 个`);
  }

  let totalCells = 0;
  let totalRows = 0;
  const sections = [];

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets?.[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    });
    if (limits?.maxRowsPerSheet && rows.length > limits.maxRowsPerSheet) {
      throw new Error(`工作表 ${sheetName} 行数超过限制，最多支持 ${limits.maxRowsPerSheet} 行`);
    }
    totalRows += rows.length;

    const normalizedRows = rows.map((row) => Array.isArray(row) ? row.slice(0, limits?.maxCols || row.length) : []);
    for (const row of normalizedRows) {
      totalCells += row.length;
      if (limits?.maxCells && totalCells > limits.maxCells) {
        throw new Error(`表格总单元格数量超过限制，最多支持 ${limits.maxCells} 个`);
      }
    }

    const lines = normalizedRows
      .filter((row) => row.some((cell) => String(cell || "").trim()))
      .map((row) => row.map((cell) => String(cell ?? "").trim()).join(" | "));

    if (lines.length > 0) {
      sections.push(`工作表：${sheetName}\n${lines.join("\n")}`);
    }
  }

  const text = normalizeExtractedText(sections.join("\n\n"));
  if (!text) throw new Error("表格文件没有可提取的文本内容");

  return {
    text,
    sheetCount: sheetNames.length,
    rowCount: totalRows,
  };
}

async function parseByCategory({ buffer, extension, category }) {
  const limits = getAttachmentLimits(category);
  if (limits?.maxBytes && buffer.byteLength > limits.maxBytes) {
    throw new Error("文件大小超过系统限制");
  }

  if (category === "text" || category === "code" || category === "data") {
    const text = decodeUtf8Text(buffer);
    assertTextLength(text, category);
    return { text };
  }

  if (category === "document") {
    if (extension === "pdf") {
      const parsed = await parsePdfBuffer(buffer, limits);
      assertTextLength(parsed.text, category);
      return parsed;
    }
    if (extension === "docx") {
      const parsed = await parseDocxBuffer(buffer);
      assertTextLength(parsed.text, category);
      return parsed;
    }
    const parsed = await parseDocBuffer(buffer, extension);
    assertTextLength(parsed.text, category);
    return parsed;
  }

  if (category === "spreadsheet") {
    const parsed = await parseSpreadsheetBuffer(buffer, extension, limits);
    assertTextLength(parsed.text, category);
    return parsed;
  }

  throw new Error("不支持解析该文件类型");
}

export async function loadBlobFileByUser({ userId, url }) {
  if (!userId || !isBlobUrlAllowed(url)) return null;
  return BlobFile.findOne({ userId, url });
}

export async function prepareDocumentAttachment({ userId, url }) {
  if (!isBlobUrlAllowed(url)) {
    throw new Error("文件地址不合法");
  }

  const blobFile = await loadBlobFileByUser({ userId, url });
  if (!blobFile) {
    throw new Error("文件不存在或无权限访问");
  }

  const originalName = sanitizeFileName(blobFile.originalName || blobFile.pathname || "file");
  const extension = getFileExtension(originalName);
  const mimeType = normalizeMimeType(blobFile.mimeType);
  const category = getAttachmentCategory({ extension, mimeType });

  if (!extension || !isSupportedDocumentExtension(extension) || !category || !isDocumentAttachment({ extension, mimeType })) {
    throw new Error("该文件不是可解析的文档附件");
  }

  if (blobFile.parseStatus === "ready" && typeof blobFile.extractedText === "string" && blobFile.extractedText.trim()) {
    return {
      file: createAttachmentDescriptor({
        url: blobFile.url,
        name: originalName,
        mimeType: blobFile.mimeType,
        size: blobFile.size,
        extension,
        category,
      }),
      extractedText: blobFile.extractedText,
    };
  }

  await BlobFile.updateOne({ _id: blobFile._id }, { $set: { parseStatus: "processing", errorMessage: null } });

  try {
    const response = await fetch(blobFile.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("文件下载失败");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    assertBinarySignature(buffer, extension);

    const parsed = await parseByCategory({ buffer, extension, category });
    const extractedText = normalizeExtractedText(parsed.text);
    if (!extractedText) {
      throw new Error("文件没有可提取的文本内容");
    }

    await BlobFile.updateOne(
      { _id: blobFile._id },
      {
        $set: {
          category,
          extension,
          parseStatus: "ready",
          extractedText,
          extractedChars: extractedText.length,
          pageCount: Number.isFinite(parsed.pageCount) ? parsed.pageCount : null,
          sheetCount: Number.isFinite(parsed.sheetCount) ? parsed.sheetCount : null,
          rowCount: Number.isFinite(parsed.rowCount) ? parsed.rowCount : null,
          errorMessage: null,
        },
      }
    );

    return {
      file: createAttachmentDescriptor({
        url: blobFile.url,
        name: originalName,
        mimeType: blobFile.mimeType,
        size: blobFile.size,
        extension,
        category,
      }),
      extractedText,
    };
  } catch (error) {
    await BlobFile.updateOne(
      { _id: blobFile._id },
      {
        $set: {
          category,
          extension,
          parseStatus: "failed",
          extractedText: null,
          extractedChars: 0,
          pageCount: null,
          sheetCount: null,
          rowCount: null,
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
  if (userId) {
    query.userId = userId;
  }
  const docs = await BlobFile.find(query)
    .select("url originalName mimeType size extension category extractedText pageCount sheetCount rowCount")
    .lean();

  const map = new Map();
  for (const doc of docs) {
    if (!doc?.url || typeof doc?.extractedText !== "string" || !doc.extractedText.trim()) continue;
    map.set(doc.url, {
      file: createAttachmentDescriptor({
        url: doc.url,
        name: doc.originalName || doc.pathname || "file",
        mimeType: doc.mimeType,
        size: doc.size,
        extension: doc.extension || getFileExtension(doc.originalName || ""),
        category: doc.category || getAttachmentCategory({ extension: doc.extension, mimeType: doc.mimeType }),
      }),
      extractedText: doc.extractedText,
      pageCount: doc.pageCount,
      sheetCount: doc.sheetCount,
      rowCount: doc.rowCount,
    });
  }
  return map;
}

export function buildAttachmentTextBlock(fileData, extractedText) {
  const descriptor = createAttachmentDescriptor(fileData || {});
  const meta = [
    descriptor.name ? `文件名：${descriptor.name}` : "",
    descriptor.extension ? `扩展名：${descriptor.extension}` : "",
    descriptor.mimeType ? `类型：${descriptor.mimeType}` : "",
  ].filter(Boolean);
  return [
    "[附件开始]",
    ...meta,
    "以下是附件提取出的文本内容：",
    extractedText,
    "[附件结束]",
  ].join("\n");
}
