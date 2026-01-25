/**
 * 共用工具函数 - Gemini 和 Claude API 都会使用
 */

const ALLOWED_IMAGE_DOMAINS = [
    "blob.vercel-storage.com",
    "public.blob.vercel-storage.com",
];

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 10000;

function isAllowedImageDomain(url) {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        return ALLOWED_IMAGE_DOMAINS.some(
            (domain) => hostname === domain || hostname.endsWith("." + domain)
        );
    } catch {
        return false;
    }
}

export async function fetchImageAsBase64(url) {
    if (typeof url !== "string" || !url.trim()) {
        throw new Error("Invalid image url");
    }

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error("Invalid image url");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Invalid image url protocol");
    }

    if (!isAllowedImageDomain(url)) {
        throw new Error("Image domain not allowed");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    try {
        const imgRes = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!imgRes.ok) throw new Error("Failed to fetch image from blob");

        const len = imgRes.headers.get("content-length");
        if (len && Number(len) > MAX_IMAGE_BYTES) {
            throw new Error("Image too large");
        }

        const arrayBuffer = await imgRes.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
            throw new Error("Image too large");
        }

        const base64Data = Buffer.from(arrayBuffer).toString("base64");
        const mimeType = imgRes.headers.get("content-type") || "image/jpeg";
        return { base64Data, mimeType };
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error("Image fetch timeout");
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

export function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

export function getStoredPartsFromMessage(msg) {
    if (Array.isArray(msg?.parts) && msg.parts.length > 0) return msg.parts;
    return null;
}

export function sanitizeStoredMessage(msg) {
    if (!msg || typeof msg !== 'object') return null;
    if (msg.role !== 'user' && msg.role !== 'model') return null;
    const out = {
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : '',
        type: typeof msg.type === 'string' ? msg.type : 'text',
    };
    if (isNonEmptyString(msg.image)) out.image = msg.image;
    if (Array.isArray(msg.images) && msg.images.length > 0) out.images = msg.images;
    if (isNonEmptyString(msg.mimeType)) out.mimeType = msg.mimeType;
    if (isNonEmptyString(msg.thought)) out.thought = msg.thought;
    if (Array.isArray(msg.citations) && msg.citations.length > 0) out.citations = msg.citations;
    if (Array.isArray(msg.parts) && msg.parts.length > 0) out.parts = msg.parts;
    return out;
}

export function sanitizeStoredMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map(sanitizeStoredMessage).filter(Boolean);
}
