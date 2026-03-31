import { handleUpload } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import { getAuthPayload } from '@/lib/auth';
import { rateLimit, getClientIP } from '@/lib/rateLimit';
import { validateMagicBytes } from '@/lib/magicBytes';
import dbConnect from '@/lib/db';
import BlobFile from '@/models/BlobFile';
import {
    createAttachmentDescriptor,
    getAttachmentInputType,
    getAllowedMimeTypesForExtension,
    getAttachmentCategory,
    getFileExtension,
    isDocumentAttachment,
    isMimeAllowedForExtension,
    isSupportedUploadExtension,
    normalizeMimeType,
} from '@/lib/shared/attachments';
import {
    CHAT_RUNTIME_MODE_AGENT,
    getModelAttachmentSupport,
    normalizeChatRuntimeMode,
} from '@/lib/shared/models';

const UPLOAD_RATE_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 };

export async function POST(request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const user = await getAuthPayload();
    if (!user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clientIP = getClientIP(request);
    const rateLimitKey = `upload:${user?.userId || 'anon'}:${clientIP}`;
    const { success, resetTime } = await rateLimit(rateLimitKey, UPLOAD_RATE_LIMIT);
    if (!success) {
        const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
        return Response.json(
            { error: '上传过于频繁，请稍后再试' },
            {
                status: 429,
                headers: {
                    'Retry-After': String(retryAfter),
                    'X-RateLimit-Remaining': '0',
                },
            }
        );
    }

    try {
        const jsonResponse = await handleUpload({
            body,
            request,
            onBeforeGenerateToken: async (pathname, clientPayload) => {
                // Authenticate
                if (!user) {
                    throw new Error('Not authorized');
                }

                let kind = 'chat';
                let declaredMimeType = '';
                let originalName = pathname;
                let extension = getFileExtension(pathname);
                let model = '';
                let mode = CHAT_RUNTIME_MODE_AGENT;
                if (typeof clientPayload === 'string' && clientPayload) {
                    try {
                        const parsed = JSON.parse(clientPayload);
                        if (parsed?.kind === 'avatar') kind = 'avatar';
                        if (typeof parsed?.declaredMimeType === 'string') declaredMimeType = normalizeMimeType(parsed.declaredMimeType);
                        if (typeof parsed?.originalName === 'string' && parsed.originalName.trim()) {
                            originalName = parsed.originalName.trim();
                            extension = getFileExtension(originalName);
                        }
                        if (typeof parsed?.model === 'string') {
                            model = parsed.model.trim();
                        }
                        mode = normalizeChatRuntimeMode(parsed?.mode);
                    } catch {
                        // ignore invalid payload
                    }
                }

                if (!extension || !isSupportedUploadExtension(extension)) {
                    throw new Error('不支持该文件类型');
                }

                if (declaredMimeType && !isMimeAllowedForExtension(extension, declaredMimeType)) {
                    throw new Error('文件类型与扩展名不匹配');
                }

                const category = getAttachmentCategory({ extension, mimeType: declaredMimeType });
                if (!category) {
                    throw new Error('不支持该文件类型');
                }

                if (kind === 'avatar' && category !== 'image') {
                    throw new Error('头像仅支持图片文件');
                }

                if (kind === 'chat') {
                    const {
                        supportsImages,
                        supportsDocuments,
                        supportsVideo,
                        supportsAudio,
                    } = getModelAttachmentSupport(model, mode);
                    const inputType = getAttachmentInputType(category);
                    const isSupported = (
                        (inputType === 'image' && supportsImages)
                        || (inputType === 'video' && supportsVideo)
                        || (inputType === 'audio' && supportsAudio)
                        || (inputType === 'file' && supportsDocuments)
                    );

                    if (!isSupported) {
                        throw new Error('当前模式不支持这类文件');
                    }
                }

                const allowedContentTypes = declaredMimeType
                    ? [declaredMimeType]
                    : getAllowedMimeTypesForExtension(extension);
                if (allowedContentTypes.length === 0) {
                    throw new Error('不支持该文件类型');
                }

                return {
                    allowedContentTypes,
                    tokenPayload: JSON.stringify({
                        userId: user.userId,
                        kind,
                        originalName,
                        mimeType: declaredMimeType,
                        extension,
                        category,
                        model,
                    }),
                };
            },
            onUploadCompleted: async ({ blob, tokenPayload }) => {
                try {
                    const payload = tokenPayload ? JSON.parse(tokenPayload) : null;
                    const userId = payload?.userId;
                    const kind = payload?.kind === 'avatar' ? 'avatar' : 'chat';
                    if (!userId || !blob?.url) return;

                    const originalName = typeof payload?.originalName === 'string' ? payload.originalName : blob.pathname;
                    const mimeType = typeof payload?.mimeType === 'string' ? payload.mimeType : normalizeMimeType(blob.contentType);
                    const extension = typeof payload?.extension === 'string' ? payload.extension : getFileExtension(originalName);

                    // Validate magic bytes for binary file types
                    const category = payload?.category || getAttachmentCategory({ extension, mimeType });
                    if (category === 'image' || category === 'document' || category === 'video' || category === 'audio') {
                        try {
                            const headRes = await fetch(blob.url, {
                                headers: { Range: 'bytes=0-31' },
                                cache: 'no-store',
                            });
                            if (headRes.ok) {
                                const headerBytes = new Uint8Array(await headRes.arrayBuffer());
                                if (!validateMagicBytes(headerBytes, mimeType)) {
                                    console.warn(`Magic bytes mismatch: ${originalName} (${mimeType}), deleting blob`);
                                    await del(blob.url);
                                    return;
                                }
                            }
                        } catch (e) {
                            console.error('Magic bytes validation error:', e?.message);
                            // Don't block upload on validation failure
                        }
                    }
                    const descriptor = createAttachmentDescriptor({
                        url: blob.url,
                        name: originalName,
                        mimeType,
                        size: Number(blob.size) || 0,
                        extension,
                        category: payload?.category || getAttachmentCategory({ extension, mimeType }),
                    });

                    await dbConnect();
                    await BlobFile.findOneAndUpdate(
                        { url: blob.url },
                        {
                            $setOnInsert: {
                                userId,
                                url: blob.url,
                                pathname: blob.pathname,
                                originalName: descriptor.name,
                                mimeType: descriptor.mimeType,
                                size: descriptor.size,
                                extension: descriptor.extension,
                                category: descriptor.category,
                                kind,
                                parseStatus: descriptor.category === 'image' ? 'ready' : 'pending',
                                createdAt: new Date(),
                            },
                        },
                        { upsert: true }
                    );
                } catch (e) {
                    console.error('onUploadCompleted error:', e?.message);
                }
            },
        });

        return Response.json(jsonResponse);
    } catch (error) {
        return Response.json(
            { error: error.message },
            { status: 400 },
        );
    }
}
