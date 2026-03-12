export const IMAGE_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const TEXT_EXTENSIONS = [
  "txt",
  "md",
  "markdown",
  "json",
  "py",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "html",
  "css",
  "xml",
  "yml",
  "yaml",
  "sql",
  "sh",
  "log",
  "ini",
  "conf",
];

const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx"];
const SPREADSHEET_EXTENSIONS = ["xls", "xlsx", "csv"];

export const SUPPORTED_DOCUMENT_EXTENSIONS = Object.freeze([
  ...TEXT_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...SPREADSHEET_EXTENSIONS,
]);

export const SUPPORTED_UPLOAD_EXTENSIONS = Object.freeze([
  ...SUPPORTED_DOCUMENT_EXTENSIONS,
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
]);

export const SUPPORTED_UPLOAD_MIME_TYPES = Object.freeze([
  ...IMAGE_MIME_TYPES,
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
  "text/json",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "text/x-python",
  "application/x-python-code",
  "application/javascript",
  "text/javascript",
  "application/typescript",
  "text/html",
  "text/css",
  "application/xml",
  "text/xml",
  "application/x-yaml",
  "text/x-yaml",
  "text/yaml",
  "text/x-sql",
  "application/octet-stream",
]);

const DOCUMENT_ACCEPT_SEGMENTS = [
  ...IMAGE_MIME_TYPES,
  ".txt",
  ".md",
  ".markdown",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".json",
  ".py",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".html",
  ".css",
  ".xml",
  ".yml",
  ".yaml",
  ".sql",
  ".sh",
];

export const ATTACHMENT_ACCEPT = DOCUMENT_ACCEPT_SEGMENTS.join(",");

const EXTENSION_MIME_MAP = {
  txt: ["text/plain", "application/octet-stream"],
  md: ["text/markdown", "text/plain", "application/octet-stream"],
  markdown: ["text/markdown", "text/plain", "application/octet-stream"],
  json: ["application/json", "text/plain", "text/json", "application/octet-stream"],
  py: ["text/x-python", "text/plain", "application/x-python-code", "application/octet-stream"],
  js: ["text/plain", "application/javascript", "text/javascript", "application/octet-stream"],
  cjs: ["text/plain", "application/javascript", "text/javascript", "application/octet-stream"],
  mjs: ["text/plain", "application/javascript", "text/javascript", "application/octet-stream"],
  ts: ["text/plain", "application/typescript", "application/octet-stream"],
  tsx: ["text/plain", "application/octet-stream"],
  jsx: ["text/plain", "application/octet-stream"],
  html: ["text/html", "text/plain", "application/octet-stream"],
  css: ["text/css", "text/plain", "application/octet-stream"],
  xml: ["application/xml", "text/xml", "text/plain", "application/octet-stream"],
  yml: ["application/x-yaml", "text/yaml", "text/plain", "application/octet-stream"],
  yaml: ["application/x-yaml", "text/yaml", "text/plain", "application/octet-stream"],
  sql: ["text/plain", "text/x-sql", "application/octet-stream"],
  sh: ["text/plain", "application/octet-stream"],
  log: ["text/plain", "application/octet-stream"],
  ini: ["text/plain", "application/octet-stream"],
  conf: ["text/plain", "application/octet-stream"],
  pdf: ["application/pdf"],
  doc: ["application/msword", "application/octet-stream"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"],
  csv: ["text/csv", "application/csv", "text/plain", "application/octet-stream"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  gif: ["image/gif"],
  webp: ["image/webp"],
};

export function getAllowedMimeTypesForExtension(extension) {
  const ext = String(extension || "").toLowerCase();
  const allowed = EXTENSION_MIME_MAP[ext];
  return Array.isArray(allowed) ? allowed.slice() : [];
}

export const ATTACHMENT_LIMITS = Object.freeze({
  image: { maxBytes: 20 * 1024 * 1024, maxChars: 0 },
  text: { maxBytes: 2 * 1024 * 1024, maxChars: 200000 },
  code: { maxBytes: 2 * 1024 * 1024, maxChars: 200000 },
  document: { maxBytes: 15 * 1024 * 1024, maxChars: 200000, maxPages: 120 },
  spreadsheet: { maxBytes: 10 * 1024 * 1024, maxChars: 200000, maxSheets: 10, maxRowsPerSheet: 5000, maxCols: 50, maxCells: 100000 },
  data: { maxBytes: 10 * 1024 * 1024, maxChars: 200000 },
});

export function normalizeMimeType(value) {
  return typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "";
}

export function getFileExtension(name) {
  if (typeof name !== "string") return "";
  const trimmed = name.trim().toLowerCase();
  const index = trimmed.lastIndexOf(".");
  if (index < 0 || index === trimmed.length - 1) return "";
  return trimmed.slice(index + 1);
}

export function isImageMimeType(mimeType) {
  return IMAGE_MIME_TYPES.includes(normalizeMimeType(mimeType));
}

export function isSupportedUploadExtension(extension) {
  return SUPPORTED_UPLOAD_EXTENSIONS.includes(String(extension || "").toLowerCase());
}

export function isSupportedDocumentExtension(extension) {
  return SUPPORTED_DOCUMENT_EXTENSIONS.includes(String(extension || "").toLowerCase());
}

export function getAttachmentCategory({ extension, mimeType }) {
  const ext = String(extension || "").toLowerCase();
  const normalizedMime = normalizeMimeType(mimeType);

  if (isImageMimeType(normalizedMime) || ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
    return "image";
  }
  if (["py", "js", "cjs", "mjs", "ts", "tsx", "jsx", "html", "css", "xml", "yml", "yaml", "sql", "sh", "ini", "conf"].includes(ext)) {
    return "code";
  }
  if (["txt", "md", "markdown", "log"].includes(ext)) {
    return "text";
  }
  if (["pdf", "doc", "docx"].includes(ext)) {
    return "document";
  }
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return "spreadsheet";
  }
  if (["json"].includes(ext)) {
    return "data";
  }
  return "";
}

export function getAttachmentLimits(category) {
  return ATTACHMENT_LIMITS[category] || null;
}

export function isDocumentAttachment({ extension, mimeType }) {
  return getAttachmentCategory({ extension, mimeType }) !== "image";
}

export function isMimeAllowedForExtension(extension, mimeType) {
  const ext = String(extension || "").toLowerCase();
  const normalizedMime = normalizeMimeType(mimeType);
  if (!ext || !normalizedMime) return false;
  const allowed = getAllowedMimeTypesForExtension(ext);
  if (!allowed.length) return false;
  return allowed.includes(normalizedMime);
}

export function createAttachmentDescriptor({
  url,
  name,
  mimeType,
  size,
  extension,
  category,
}) {
  const normalizedExtension = String(extension || getFileExtension(name)).toLowerCase();
  const normalizedMime = normalizeMimeType(mimeType);
  const normalizedCategory = category || getAttachmentCategory({ extension: normalizedExtension, mimeType: normalizedMime });
  return {
    url,
    name: typeof name === "string" ? name : "",
    mimeType: normalizedMime,
    size: Number.isFinite(size) ? size : 0,
    extension: normalizedExtension,
    category: normalizedCategory,
  };
}

export function formatFileSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function getAttachmentAcceptForModel(supportsDocuments) {
  return supportsDocuments ? ATTACHMENT_ACCEPT : IMAGE_MIME_TYPES.join(",");
}
