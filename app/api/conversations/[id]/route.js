import dbConnect from '@/lib/db';
import Conversation from '@/models/Conversation';
import { getAuthPayload } from '@/lib/auth';
import mongoose from 'mongoose';

const ALLOWED_UPDATE_KEYS = new Set(['title', 'messages', 'settings']);
const ALLOWED_SETTINGS_KEYS = new Set(['thinkingLevel', 'historyLimit', 'maxTokens', 'budgetTokens', 'activePromptId']);
const ALLOWED_MESSAGE_TYPES = new Set(['text', 'parts', 'error']);
const ALLOWED_ROLES = new Set(['user', 'model']);

const MAX_REQUEST_BYTES = 2_000_000;
const MAX_MESSAGES = 500;
const MAX_MESSAGE_CHARS = 20000;
const MAX_PART_TEXT_CHARS = 10000;
const MAX_PARTS_PER_MESSAGE = 20;
const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_URL_CHARS = 2048;
const MAX_TITLE_CHARS = 200;
const MAX_CITATIONS = 20;
const MAX_CITATION_TITLE_CHARS = 200;
const MAX_CITATION_TEXT_CHARS = 1000;

const ALLOWED_IMAGE_DOMAINS = [
    'blob.vercel-storage.com',
    'public.blob.vercel-storage.com',
];

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAllowedImageUrl(url) {
    if (typeof url !== 'string' || !url.trim() || url.length > MAX_URL_CHARS) return false;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        const hostname = parsed.hostname.toLowerCase();
        return ALLOWED_IMAGE_DOMAINS.some(
            (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
        );
    } catch {
        return false;
    }
}

function sanitizeMessage(msg, idx) {
    if (!isPlainObject(msg)) throw new Error(`messages[${idx}] must be an object`);

    const role = msg.role;
    const type = msg.type ?? 'text';
    if (!ALLOWED_ROLES.has(role)) throw new Error(`messages[${idx}].role invalid`);
    if (!ALLOWED_MESSAGE_TYPES.has(type)) throw new Error(`messages[${idx}].type invalid`);

    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content.length > MAX_MESSAGE_CHARS) throw new Error(`messages[${idx}].content too long`);

    const out = { role, type, content };

    if (typeof msg.thought === 'string') {
        if (msg.thought.length > MAX_MESSAGE_CHARS) throw new Error(`messages[${idx}].thought too long`);
        if (msg.thought) out.thought = msg.thought;
    }

    if (typeof msg.image === 'string') {
        if (!isAllowedImageUrl(msg.image)) throw new Error(`messages[${idx}].image invalid`);
        out.image = msg.image;
    }

    if (Array.isArray(msg.images)) {
        if (msg.images.length > MAX_IMAGES_PER_MESSAGE) throw new Error(`messages[${idx}].images too many`);
        const filtered = msg.images.filter((url) => isAllowedImageUrl(url));
        if (filtered.length !== msg.images.length) throw new Error(`messages[${idx}].images invalid`);
        out.images = filtered;
    }

    if (typeof msg.mimeType === 'string' && msg.mimeType.length <= 128) {
        out.mimeType = msg.mimeType;
    }

    if (Array.isArray(msg.citations)) {
        if (msg.citations.length > MAX_CITATIONS) throw new Error(`messages[${idx}].citations too many`);
        const citations = [];
        for (const c of msg.citations) {
            if (!isPlainObject(c)) continue;
            const url = typeof c.url === 'string' ? c.url : '';
            const title = typeof c.title === 'string' ? c.title : '';
            const citedText = typeof c.cited_text === 'string' ? c.cited_text : '';
            if (!url || url.length > MAX_URL_CHARS) continue;
            const entry = { url, title: title.slice(0, MAX_CITATION_TITLE_CHARS) || null };
            if (citedText) entry.cited_text = citedText.slice(0, MAX_CITATION_TEXT_CHARS);
            citations.push(entry);
        }
        if (citations.length > 0) out.citations = citations;
    }

    if (Array.isArray(msg.parts)) {
        if (msg.parts.length > MAX_PARTS_PER_MESSAGE) throw new Error(`messages[${idx}].parts too many`);
        const parts = [];
        for (const part of msg.parts) {
            if (!isPlainObject(part)) continue;
            const p = {};
            if (typeof part.text === 'string') {
                if (part.text.length > MAX_PART_TEXT_CHARS) {
                    throw new Error(`messages[${idx}].parts text too long`);
                }
                if (part.text) p.text = part.text;
            }
            if (isPlainObject(part.inlineData)) {
                const url = part.inlineData.url;
                if (!isAllowedImageUrl(url)) throw new Error(`messages[${idx}].parts image invalid`);
                const mimeType = typeof part.inlineData.mimeType === 'string' ? part.inlineData.mimeType : 'image/jpeg';
                p.inlineData = { url, mimeType: mimeType.slice(0, 128) };
            }
            if (typeof part.thoughtSignature === 'string' && part.thoughtSignature.length <= 256) {
                p.thoughtSignature = part.thoughtSignature;
            }
            if (Object.keys(p).length > 0) parts.push(p);
        }
        if (parts.length > 0) out.parts = parts;
    }

    if (msg.createdAt) {
        const d = new Date(msg.createdAt);
        if (!Number.isNaN(d.getTime())) out.createdAt = d;
    }

    return out;
}

function sanitizeMessages(messages) {
    if (!Array.isArray(messages)) return [];
    if (messages.length > MAX_MESSAGES) throw new Error(`messages too many (max ${MAX_MESSAGES})`);
    return messages.map((m, idx) => sanitizeMessage(m, idx));
}

function sanitizeSettings(settings) {
    const updates = {};
    for (const [settingKey, settingValue] of Object.entries(settings || {})) {
        if (!ALLOWED_SETTINGS_KEYS.has(settingKey)) continue;
        if (settingKey === 'thinkingLevel') {
            if (typeof settingValue !== 'string' || settingValue.length > 20) {
                throw new Error('settings.thinkingLevel invalid');
            }
            updates[`settings.${settingKey}`] = settingValue;
            continue;
        }
        if (settingKey === 'activePromptId') {
            if (typeof settingValue !== 'string' || settingValue.length > 128) {
                throw new Error('settings.activePromptId invalid');
            }
            updates[`settings.${settingKey}`] = settingValue;
            continue;
        }
        if (!Number.isFinite(settingValue) || settingValue < 0 || settingValue > 200000) {
            throw new Error(`settings.${settingKey} invalid`);
        }
        updates[`settings.${settingKey}`] = settingValue;
    }
    return updates;
}

export async function GET(req, { params }) {
    if (!mongoose.isValidObjectId(params.id)) {
        return Response.json({ error: 'Invalid id' }, { status: 400 });
    }
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const conversation = await Conversation.findOne({ _id: params.id, userId: user.userId });
    if (!conversation) return Response.json({ error: 'Not found' }, { status: 404 });

    return Response.json({ conversation });
}

export async function DELETE(req, { params }) {
    if (!mongoose.isValidObjectId(params.id)) {
        return Response.json({ error: 'Invalid id' }, { status: 400 });
    }
    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    await Conversation.deleteOne({ _id: params.id, userId: user.userId });
    return Response.json({ success: true });
}

export async function PUT(req, { params }) {
    if (!mongoose.isValidObjectId(params.id)) {
        return Response.json({ error: 'Invalid id' }, { status: 400 });
    }

    const contentLength = req.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
        return Response.json({ error: 'Request too large' }, { status: 413 });
    }

    await dbConnect();
    const user = await getAuthPayload();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let body;
    try {
        body = await req.json();
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    for (const key of Object.keys(body)) {
        if (!ALLOWED_UPDATE_KEYS.has(key)) {
            return Response.json({ error: 'Unsupported field in request body' }, { status: 400 });
        }
    }

    if (body?.messages !== undefined && !Array.isArray(body.messages)) {
        return Response.json({ error: 'messages must be an array' }, { status: 400 });
    }

    if (body?.settings !== undefined) {
        if (typeof body.settings !== 'object' || body.settings === null || Array.isArray(body.settings)) {
            return Response.json({ error: 'settings must be an object' }, { status: 400 });
        }
    }

    // 构建更新对象，支持 settings 的部分更新
    const updateObj = { updatedAt: Date.now() };
    if (typeof body.title === 'string') {
        if (body.title.length > MAX_TITLE_CHARS) {
            return Response.json({ error: 'title too long' }, { status: 400 });
        }
        updateObj.title = body.title;
    }

    if (Array.isArray(body.messages)) {
        try {
            updateObj.messages = sanitizeMessages(body.messages);
        } catch (e) {
            return Response.json({ error: e?.message || 'Invalid messages' }, { status: 400 });
        }
    }

    if (body.settings && typeof body.settings === 'object') {
        try {
            const settingsUpdates = sanitizeSettings(body.settings);
            Object.assign(updateObj, settingsUpdates);
        } catch (e) {
            return Response.json({ error: e?.message || 'Invalid settings' }, { status: 400 });
        }
    }

    const conversation = await Conversation.findOneAndUpdate(
        { _id: params.id, userId: user.userId },
        { $set: updateObj },
        { new: true }
    );

    return Response.json({ conversation });
}
