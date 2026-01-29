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

export function generateMessageId() {
    const rand = Math.random().toString(36).slice(2, 10);
    return `msg_${Date.now()}_${rand}`;
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
    if (isNonEmptyString(msg.id) && msg.id.length <= 128) out.id = msg.id;
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

export function injectCurrentTimeSystemReminder(systemText) {
    if (typeof systemText !== 'string') return systemText;
    if (systemText.includes("<system-reminder>")) return systemText;

    let timeText = "";
    try {
        const formatter = new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(new Date());
        const map = {};
        for (const p of parts) map[p.type] = p.value;
        timeText = `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
    } catch {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        timeText = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    const reminder = `\n\n<system-reminder>\n当前时间：${timeText}（时区：Asia/Shanghai）。你必须以此为准进行判断与回答，不要把现在当成 2024 年。\n</system-reminder>`;
    return `${systemText}${reminder}`;
}
