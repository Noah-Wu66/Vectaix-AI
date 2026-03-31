/**
 * File signature (magic bytes) validation.
 * Checks the first few bytes of a file to verify its actual type matches the declared type.
 */

// Map of MIME types to their magic byte signatures
const SIGNATURES = {
  // Images
  'image/jpeg': [
    [0xFF, 0xD8, 0xFF],
  ],
  'image/png': [
    [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  ],
  'image/gif': [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  ],
  'image/webp': [
    // RIFF....WEBP (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
    null, // special handling below
  ],
  // Documents
  'application/pdf': [
    [0x25, 0x50, 0x44, 0x46], // %PDF
  ],
  'application/zip': [
    [0x50, 0x4B, 0x03, 0x04], // PK..
    [0x50, 0x4B, 0x05, 0x06], // Empty archive
  ],
  // Office formats (ZIP-based)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    [0x50, 0x4B, 0x03, 0x04], // .docx is ZIP
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    [0x50, 0x4B, 0x03, 0x04], // .xlsx is ZIP
  ],
  // Legacy Office
  'application/msword': [
    [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], // OLE Compound
  ],
  'application/vnd.ms-excel': [
    [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], // OLE Compound
  ],
  // Audio
  'audio/mpeg': [
    [0xFF, 0xFB], // MP3 frame sync
    [0xFF, 0xF3],
    [0xFF, 0xF2],
    [0x49, 0x44, 0x33], // ID3 tag
  ],
  'audio/wav': [
    [0x52, 0x49, 0x46, 0x46], // RIFF
  ],
  'audio/ogg': [
    [0x4F, 0x67, 0x67, 0x53], // OggS
  ],
  'audio/aac': [
    [0xFF, 0xF1], // ADTS frame
    [0xFF, 0xF9],
  ],
  // Video
  'video/mp4': [
    null, // ftyp box at offset 4 – special handling
  ],
  'video/webm': [
    [0x1A, 0x45, 0xDF, 0xA3], // EBML header
  ],
  'video/quicktime': [
    null, // ftyp box – same as mp4
  ],
};

function matchBytes(buffer, signature, offset = 0) {
  if (buffer.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buffer[offset + i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Validate that the file's magic bytes match the declared MIME type.
 * Returns true if the file appears genuine, false if suspicious.
 *
 * For MIME types we don't have signatures for (text files, etc.), returns true.
 *
 * @param {ArrayBuffer|Uint8Array} headerBytes - First 12+ bytes of the file
 * @param {string} declaredMime - The declared MIME type to validate against
 * @returns {boolean}
 */
export function validateMagicBytes(headerBytes, declaredMime) {
  const buffer = headerBytes instanceof Uint8Array
    ? headerBytes
    : new Uint8Array(headerBytes);

  if (buffer.length < 4) return true; // Too small to validate

  const mime = declaredMime?.toLowerCase?.() || '';

  // Special case: WebP (RIFF....WEBP)
  if (mime === 'image/webp') {
    return matchBytes(buffer, [0x52, 0x49, 0x46, 0x46]) && // RIFF
           buffer.length >= 12 &&
           matchBytes(buffer, [0x57, 0x45, 0x42, 0x50], 8); // WEBP
  }

  // Special case: MP4/MOV (ftyp box at offset 4)
  if (mime === 'video/mp4' || mime === 'video/quicktime' || mime === 'video/x-m4v' ||
      mime === 'audio/mp4' || mime === 'audio/x-m4a') {
    return buffer.length >= 8 &&
           matchBytes(buffer, [0x66, 0x74, 0x79, 0x70], 4); // ftyp
  }

  const signatures = SIGNATURES[mime];
  if (!signatures) return true; // No signature to check – allow

  for (const sig of signatures) {
    if (sig === null) continue; // Special-cased above
    if (matchBytes(buffer, sig)) return true;
  }

  return false;
}
