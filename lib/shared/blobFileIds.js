const BLOB_FILE_ID_PATTERN = /^[a-f\d]{24}$/i;

export function normalizeBlobFileId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || !BLOB_FILE_ID_PATTERN.test(normalized)) return null;
  return normalized;
}

