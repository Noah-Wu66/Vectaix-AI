import { promises as fs } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { put } from "@vercel/blob";
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

const FILE_PARSE_VERSION = 2;
const MAX_VISUAL_ASSETS = 6;
const MAX_VISUAL_ASSET_BYTES = 4 * 1024 * 1024;
const MAX_VISUAL_SUMMARY_ITEMS = 4;

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

function decodeHtmlEntities(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToStructuredText(html) {
  if (typeof html !== "string" || !html.trim()) return "";
  const text = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|section|article|table|thead|tbody|tfoot|ul|ol)\s*>/gi, "\n")
    .replace(/<\s*h1[^>]*>/gi, "\n# ")
    .replace(/<\s*h2[^>]*>/gi, "\n## ")
    .replace(/<\s*h3[^>]*>/gi, "\n### ")
    .replace(/<\s*h4[^>]*>/gi, "\n#### ")
    .replace(/<\s*h5[^>]*>/gi, "\n##### ")
    .replace(/<\s*h6[^>]*>/gi, "\n###### ")
    .replace(/<\s*\/\s*h[1-6]\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*\/\s*li\s*>/gi, "")
    .replace(/<\s*tr[^>]*>/gi, "\n| ")
    .replace(/<\s*\/\s*tr\s*>/gi, " |")
    .replace(/<\s*t[dh][^>]*>/gi, "")
    .replace(/<\s*\/\s*t[dh]\s*>/gi, " | ")
    .replace(/<\s*strong[^>]*>/gi, "**")
    .replace(/<\s*\/\s*strong\s*>/gi, "**")
    .replace(/<\s*b[^>]*>/gi, "**")
    .replace(/<\s*\/\s*b\s*>/gi, "**")
    .replace(/<\s*em[^>]*>/gi, "*")
    .replace(/<\s*\/\s*em\s*>/gi, "*")
    .replace(/<\s*i[^>]*>/gi, "*")
    .replace(/<\s*\/\s*i\s*>/gi, "*")
    .replace(/<[^>]+>/g, " ");
  return normalizeExtractedText(decodeHtmlEntities(text));
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

function getMimeExtension(mimeType) {
  const normalized = normalizeMimeType(mimeType);
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/webp") return "webp";
  return "bin";
}

function buildPreparedFileDescriptor({ url, name, mimeType, size, extension, category, formatSummary, visualAssets }) {
  const descriptor = createAttachmentDescriptor({ url, name, mimeType, size, extension, category });
  const assets = Array.isArray(visualAssets)
    ? visualAssets.filter((item) => item?.url && item?.mimeType)
    : [];
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
    .slice(0, MAX_VISUAL_SUMMARY_ITEMS)
    .map((item) => item?.label || item?.sourceType || "图片")
    .filter(Boolean);
  const labelText = labels.length > 0 ? `：${labels.join("、")}` : "";
  return `已额外提取 ${assets.length} 个视觉内容${labelText}`;
}

async function saveDocumentVisualAsset({ userId, blobFile, buffer, mimeType, label, sourceType, page, sheet }) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    if (buffer.length > MAX_VISUAL_ASSET_BYTES) return null;
    const safeName = sanitizeFileName(blobFile?.originalName || blobFile?.pathname || "document").replace(/\.[^.]+$/, "");
    const extension = getMimeExtension(mimeType);
    const pathname = `document-assets/${String(userId || "anon")}/${safeName}-${crypto.randomUUID()}.${extension}`;
    const blob = await put(pathname, buffer, {
      access: "public",
      addRandomSuffix: false,
      contentType: mimeType,
    });
    return {
      url: blob.url,
      mimeType,
      size: buffer.length,
      label: typeof label === "string" ? label : "图片",
      sourceType: typeof sourceType === "string" ? sourceType : "embedded-image",
      page: Number.isFinite(page) ? page : null,
      sheet: typeof sheet === "string" && sheet ? sheet : null,
    };
  } catch {
    return null;
  }
}

function summarizeDocxFormat(html, visualAssets) {
  const features = [];
  if (/<h[1-6][^>]*>/i.test(html)) features.push("标题层级");
  if (/<(ul|ol)[^>]*>/i.test(html)) features.push("列表");
  if (/<table[^>]*>/i.test(html)) features.push("表格");
  if (/<(strong|b)[^>]*>/i.test(html)) features.push("强调文本");
  if (Array.isArray(visualAssets) && visualAssets.length > 0) features.push(`${visualAssets.length} 张内嵌图片`);
  if (features.length === 0) return "保留了段落顺序。";
  return `保留了 ${features.join("、")}。`;
}

function summarizePdfFormat(pageCount) {
  return pageCount > 0 ? `按页保留正文顺序，共 ${pageCount} 页。` : "按页保留正文顺序。";
}

function findBinarySequence(buffer, seq, start = 0) {
  if (!Buffer.isBuffer(buffer) || !Buffer.isBuffer(seq) || seq.length === 0) return -1;
  return buffer.indexOf(seq, start);
}

function extractBinaryAssetsFromBuffer(buffer, { startMarker, endMarker, minBytes = 1024, maxItems = MAX_VISUAL_ASSETS }) {
  if (!Buffer.isBuffer(buffer) || !Buffer.isBuffer(startMarker) || !Buffer.isBuffer(endMarker)) return [];
  const assets = [];
  let cursor = 0;
  while (cursor < buffer.length && assets.length < maxItems) {
    const start = findBinarySequence(buffer, startMarker, cursor);
    if (start < 0) break;
    const end = findBinarySequence(buffer, endMarker, start + startMarker.length);
    if (end < 0) break;
    const sliceEnd = end + endMarker.length;
    const chunk = buffer.slice(start, sliceEnd);
    if (chunk.length >= minBytes) assets.push(chunk);
    cursor = sliceEnd;
  }
  return assets;
}

async function extractPdfVisualAssets(buffer, context) {
  const jpegStart = Buffer.from([0xff, 0xd8, 0xff]);
  const jpegEnd = Buffer.from([0xff, 0xd9]);
  const pngStart = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngEnd = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const candidates = [
    ...extractBinaryAssetsFromBuffer(buffer, { startMarker: jpegStart, endMarker: jpegEnd, minBytes: 4096, maxItems: MAX_VISUAL_ASSETS }).map((item) => ({ buffer: item, mimeType: "image/jpeg" })),
    ...extractBinaryAssetsFromBuffer(buffer, { startMarker: pngStart, endMarker: pngEnd, minBytes: 2048, maxItems: MAX_VISUAL_ASSETS }).map((item) => ({ buffer: item, mimeType: "image/png" })),
  ];
  const results = [];
  const hashes = new Set();
  for (const candidate of candidates) {
    if (results.length >= MAX_VISUAL_ASSETS) break;
    const hash = crypto.createHash("sha1").update(candidate.buffer).digest("hex");
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    const asset = await saveDocumentVisualAsset({
      userId: context.userId,
      blobFile: context.blobFile,
      buffer: candidate.buffer,
      mimeType: candidate.mimeType,
      label: `PDF 图片 ${results.length + 1}`,
      sourceType: "embedded-image",
    });
    if (asset) results.push(asset);
  }
  return results;
}

function summarizeSpreadsheetFormat({ sheetCount, rowCount, visualAssets }) {
  const parts = [];
  if (sheetCount > 0) parts.push(`${sheetCount} 个工作表`);
  if (rowCount > 0) parts.push(`约 ${rowCount} 行数据`);
  if (Array.isArray(visualAssets) && visualAssets.length > 0) parts.push(`${visualAssets.length} 张工作簿图片`);
  return parts.length > 0 ? `保留了表格结构，包含 ${parts.join("、")}。` : "保留了表格结构。";
}

function normalizeVisualAssets(visualAssets) {
  if (!Array.isArray(visualAssets)) return [];
  return visualAssets
    .filter((item) => item?.url && item?.mimeType)
    .slice(0, MAX_VISUAL_ASSETS)
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

function extractWorkbookFileBuffer(file) {
  if (!file) return null;
  if (Buffer.isBuffer(file)) return file;
  if (file instanceof Uint8Array) return Buffer.from(file);
  if (Buffer.isBuffer(file?.content)) return file.content;
  if (file?.content instanceof Uint8Array) return Buffer.from(file.content);
  if (Buffer.isBuffer(file?.data)) return file.data;
  if (file?.data instanceof Uint8Array) return Buffer.from(file.data);
  if (typeof file?.asNodeBuffer === "function") {
    try {
      const result = file.asNodeBuffer();
      if (Buffer.isBuffer(result)) return result;
      if (result instanceof Uint8Array) return Buffer.from(result);
    } catch {
      return null;
    }
  }
  return null;
}

async function parsePdfBuffer(buffer, limits, context) {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  let pageSeq = 0;
  const result = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      pageSeq += 1;
      const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      const rows = [];
      let lastY = null;
      let currentLine = [];
      for (const item of Array.isArray(textContent?.items) ? textContent.items : []) {
        const y = Array.isArray(item?.transform) ? item.transform[5] : null;
        const str = typeof item?.str === "string" ? item.str : "";
        if (!str) continue;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && currentLine.length > 0) {
          rows.push(currentLine.join(" "));
          currentLine = [];
        }
        currentLine.push(str);
        lastY = y;
      }
      if (currentLine.length > 0) rows.push(currentLine.join(" "));
      return `[第 ${pageSeq} 页]\n${rows.join("\n")}`;
    },
  });
  const text = normalizeExtractedText(result?.text || "");
  if (!text) throw new Error("PDF 没有可提取的文本内容");
  if (limits?.maxPages && Number(result.numpages) > limits.maxPages) {
    throw new Error(`PDF 页数超过限制，最多支持 ${limits.maxPages} 页`);
  }
  const pageCount = Number.isFinite(result.numpages) ? result.numpages : null;
  const visualAssets = await extractPdfVisualAssets(buffer, context);
  return {
    text,
    structuredText: text,
    formatSummary: `${summarizePdfFormat(pageCount || 0)}${visualAssets.length > 0 ? ` 已提取 ${visualAssets.length} 个 PDF 视觉资源。` : ""}`,
    pageCount,
    visualAssets: normalizeVisualAssets(visualAssets),
  };
}

async function parseDocxBuffer(buffer, context) {
  const mammothModule = await import("mammoth");
  const mammoth = mammothModule.default || mammothModule;
  const rawResult = await mammoth.extractRawText({ buffer });
  const visualAssets = [];
  const convertOptions = mammoth?.images?.imgElement
    ? {
      convertImage: mammoth.images.imgElement(async (image) => {
        try {
          const mimeType = normalizeMimeType(image?.contentType) || "image/png";
          const base64 = await image.read("base64");
          if (!base64) return { src: "" };
          const asset = await saveDocumentVisualAsset({
            userId: context.userId,
            blobFile: context.blobFile,
            buffer: Buffer.from(base64, "base64"),
            mimeType,
            label: `文档图片 ${visualAssets.length + 1}`,
            sourceType: "embedded-image",
          });
          if (asset && visualAssets.length < MAX_VISUAL_ASSETS) visualAssets.push(asset);
          return { src: `data:${mimeType};base64,${base64}` };
        } catch {
          return { src: "" };
        }
      }),
    }
    : undefined;
  const htmlResult = await mammoth.convertToHtml({ buffer }, convertOptions);
  const html = typeof htmlResult?.value === "string" ? htmlResult.value : "";
  const structuredText = normalizeExtractedText(htmlToStructuredText(html));
  const rawText = normalizeExtractedText(rawResult?.value || "");
  const text = structuredText || rawText;
  if (!text) throw new Error("DOCX 没有可提取的文本内容");
  return {
    text,
    structuredText: text,
    formatSummary: summarizeDocxFormat(html, visualAssets),
    visualAssets: normalizeVisualAssets(visualAssets),
  };
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
    return {
      text,
      structuredText: text,
      formatSummary: "旧版 Word 仅提取了正文文本，未保留图片与复杂版式。",
      visualAssets: [],
    };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

async function extractSpreadsheetVisualAssets(workbook, context) {
  const files = workbook?.files && typeof workbook.files === "object" ? workbook.files : null;
  if (!files) return [];
  const results = [];
  for (const [name, file] of Object.entries(files)) {
    if (!/^xl\/media\/.+\.(png|jpe?g|gif|webp)$/i.test(name)) continue;
    if (results.length >= MAX_VISUAL_ASSETS) break;
    const fileBuffer = extractWorkbookFileBuffer(file);
    if (!fileBuffer) continue;
    const extension = getFileExtension(name);
    const mimeType = extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "gif"
        ? "image/gif"
        : extension === "webp"
          ? "image/webp"
          : "image/png";
    const asset = await saveDocumentVisualAsset({
      userId: context.userId,
      blobFile: context.blobFile,
      buffer: fileBuffer,
      mimeType,
      label: `工作簿图片 ${results.length + 1}`,
      sourceType: "embedded-image",
    });
    if (asset) results.push(asset);
  }
  return results;
}

async function parseSpreadsheetBuffer(buffer, extension, limits, context) {
  const xlsxModule = await import("xlsx");
  const XLSX = xlsxModule.default || xlsxModule;
  const workbook = XLSX.read(buffer, { type: "buffer", dense: true, cellHTML: true, bookFiles: true });
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
  const visualAssets = await extractSpreadsheetVisualAssets(workbook, context);

  return {
    text,
    structuredText: text,
    formatSummary: summarizeSpreadsheetFormat({ sheetCount: sheetNames.length, rowCount: totalRows, visualAssets }),
    sheetCount: sheetNames.length,
    rowCount: totalRows,
    visualAssets: normalizeVisualAssets(visualAssets),
  };
}

async function parseByCategory({ buffer, extension, category, context }) {
  const limits = getAttachmentLimits(category);
  if (limits?.maxBytes && buffer.byteLength > limits.maxBytes) {
    throw new Error("文件大小超过系统限制");
  }

  if (category === "text" || category === "code" || category === "data") {
    const text = decodeUtf8Text(buffer);
    assertTextLength(text, category);
    return {
      text,
      structuredText: text,
      formatSummary: "保留了原始文本顺序。",
      visualAssets: [],
    };
  }

  if (category === "document") {
    if (extension === "pdf") {
      const parsed = await parsePdfBuffer(buffer, limits, context);
      assertTextLength(parsed.text, category);
      return parsed;
    }
    if (extension === "docx") {
      const parsed = await parseDocxBuffer(buffer, context);
      assertTextLength(parsed.text, category);
      return parsed;
    }
    const parsed = await parseDocBuffer(buffer, extension);
    assertTextLength(parsed.text, category);
    return parsed;
  }

  if (category === "spreadsheet") {
    const parsed = await parseSpreadsheetBuffer(buffer, extension, limits, context);
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

  const existingVisualAssets = normalizeVisualAssets(blobFile.visualAssets);
  const readyAndFresh = blobFile.parseStatus === "ready"
    && typeof blobFile.extractedText === "string"
    && blobFile.extractedText.trim()
    && Number(blobFile.parseVersion) >= FILE_PARSE_VERSION;

  if (readyAndFresh) {
    return {
      file: buildPreparedFileDescriptor({
        url: blobFile.url,
        name: originalName,
        mimeType: blobFile.mimeType,
        size: blobFile.size,
        extension,
        category,
        formatSummary: blobFile.formatSummary,
        visualAssets: existingVisualAssets,
      }),
      extractedText: blobFile.extractedText,
      structuredText: blobFile.structuredText || blobFile.extractedText,
      formatSummary: blobFile.formatSummary || "",
      visualAssets: existingVisualAssets,
      pageCount: Number.isFinite(blobFile.pageCount) ? blobFile.pageCount : null,
      sheetCount: Number.isFinite(blobFile.sheetCount) ? blobFile.sheetCount : null,
      rowCount: Number.isFinite(blobFile.rowCount) ? blobFile.rowCount : null,
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

    const parsed = await parseByCategory({
      buffer,
      extension,
      category,
      context: { userId, blobFile },
    });
    const extractedText = normalizeExtractedText(parsed.text);
    const structuredText = normalizeExtractedText(parsed.structuredText || parsed.text);
    if (!extractedText) {
      throw new Error("文件没有可提取的文本内容");
    }
    const visualAssets = normalizeVisualAssets(parsed.visualAssets);
    const formatSummary = normalizeExtractedText(parsed.formatSummary || "");

    await BlobFile.updateOne(
      { _id: blobFile._id },
      {
        $set: {
          category,
          extension,
          parseStatus: "ready",
          extractedText,
          structuredText,
          formatSummary,
          visualAssets,
          visualAssetCount: visualAssets.length,
          parseVersion: FILE_PARSE_VERSION,
          extractedChars: extractedText.length,
          pageCount: Number.isFinite(parsed.pageCount) ? parsed.pageCount : null,
          sheetCount: Number.isFinite(parsed.sheetCount) ? parsed.sheetCount : null,
          rowCount: Number.isFinite(parsed.rowCount) ? parsed.rowCount : null,
          errorMessage: null,
        },
      }
    );

    return {
      file: buildPreparedFileDescriptor({
        url: blobFile.url,
        name: originalName,
        mimeType: blobFile.mimeType,
        size: blobFile.size,
        extension,
        category,
        formatSummary,
        visualAssets,
      }),
      extractedText,
      structuredText,
      formatSummary,
      visualAssets,
      pageCount: Number.isFinite(parsed.pageCount) ? parsed.pageCount : null,
      sheetCount: Number.isFinite(parsed.sheetCount) ? parsed.sheetCount : null,
      rowCount: Number.isFinite(parsed.rowCount) ? parsed.rowCount : null,
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
          structuredText: null,
          formatSummary: null,
          visualAssets: [],
          visualAssetCount: 0,
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
    .select("url originalName pathname mimeType size extension category extractedText structuredText formatSummary visualAssets visualAssetCount pageCount sheetCount rowCount")
    .lean();

  const map = new Map();
  for (const doc of docs) {
    if (!doc?.url || typeof doc?.extractedText !== "string" || !doc.extractedText.trim()) continue;
    const visualAssets = normalizeVisualAssets(doc.visualAssets);
    map.set(doc.url, {
      file: buildPreparedFileDescriptor({
        url: doc.url,
        name: doc.originalName || doc.pathname || "file",
        mimeType: doc.mimeType,
        size: doc.size,
        extension: doc.extension || getFileExtension(doc.originalName || ""),
        category: doc.category || getAttachmentCategory({ extension: doc.extension, mimeType: doc.mimeType }),
        formatSummary: doc.formatSummary,
        visualAssets,
      }),
      extractedText: doc.extractedText,
      structuredText: doc.structuredText || doc.extractedText,
      formatSummary: doc.formatSummary || "",
      visualAssets,
      visualAssetCount: Number(doc.visualAssetCount) || visualAssets.length,
      pageCount: doc.pageCount,
      sheetCount: doc.sheetCount,
      rowCount: doc.rowCount,
    });
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
    extractedText,
    "[附件结束]",
  ].join("\n");
}
