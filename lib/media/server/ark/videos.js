import crypto from "crypto";
import { resolveArkVideoProviderConfig } from "@/lib/modelRoutes";
import { saveMediaFromUrl } from "@/lib/media/storage";
import { VIDEO_MODEL } from "@/lib/media/shared/models";

export const ARK_VIDEO_ACTIVE_STATUSES = new Set(["queued", "running"]);

function getAuthHeaders() {
  const { apiKey } = resolveArkVideoProviderConfig();
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function readArkJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error?.message === "string"
      ? data.error.message
      : (typeof data?.message === "string" ? data.message : `火山方舟请求失败（${response.status}）`);
    const error = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

async function assertArkOkResponse(response) {
  if (response.ok) return;
  let message = `火山方舟请求失败（${response.status}）`;
  const data = await response.json().catch(() => null);
  if (typeof data?.error?.message === "string") {
    message = data.error.message;
  } else if (typeof data?.message === "string") {
    message = data.message;
  }
  const error = new Error(message);
  error.status = response.status;
  error.payload = data;
  throw error;
}

function getTasksBaseUrl() {
  return resolveArkVideoProviderConfig().baseUrl;
}

function buildTaskUrl(taskId) {
  return `${getTasksBaseUrl()}/${encodeURIComponent(taskId)}`;
}

function getUnixDate(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp * 1000);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildSafetyIdentifier(userId) {
  return crypto
    .createHash("sha256")
    .update(String(userId || ""))
    .digest("hex")
    .slice(0, 64);
}

export async function fileToDataUrl(file) {
  const bytes = Buffer.from(await file.arrayBuffer()).toString("base64");
  const mimeType = normalizeText(file.type) || "image/png";
  return `data:${mimeType};base64,${bytes}`;
}

export async function createArkVideoTask({
  prompt,
  image,
  lastFrame,
  ratio,
  duration,
  resolution,
  generateAudio,
  watermark,
  returnLastFrame,
  priority,
  webSearch,
  safetyIdentifier,
  signal,
}) {
  const content = [];
  const cleanPrompt = normalizeText(prompt);
  if (cleanPrompt) {
    content.push({
      type: "text",
      text: cleanPrompt,
    });
  }

  if (image) {
    content.push({
      type: "image_url",
      role: "first_frame",
      image_url: {
        url: await fileToDataUrl(image),
      },
    });
  }

  if (lastFrame) {
    content.push({
      type: "image_url",
      role: "last_frame",
      image_url: {
        url: await fileToDataUrl(lastFrame),
      },
    });
  }

  const body = {
    model: VIDEO_MODEL,
    content,
    resolution,
    ratio,
    duration,
    generate_audio: Boolean(generateAudio),
    watermark: Boolean(watermark),
    return_last_frame: Boolean(returnLastFrame),
    priority,
    safety_identifier: safetyIdentifier,
  };

  if (webSearch) {
    body.tools = [{ type: "web_search" }];
  }

  const response = await fetch(getTasksBaseUrl(), {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
    signal,
  });

  return readArkJsonResponse(response);
}

export async function getArkVideoTask(taskId, { signal } = {}) {
  const response = await fetch(buildTaskUrl(taskId), {
    method: "GET",
    headers: getAuthHeaders(),
    signal,
  });
  return readArkJsonResponse(response);
}

export async function deleteArkVideoTask(taskId, { signal } = {}) {
  const response = await fetch(buildTaskUrl(taskId), {
    method: "DELETE",
    headers: getAuthHeaders(),
    signal,
  });
  await assertArkOkResponse(response);
}

export async function storeArkVideoOutput(arkTask) {
  const remoteVideoUrl = normalizeText(arkTask?.content?.video_url);
  const remoteLastFrameUrl = normalizeText(arkTask?.content?.last_frame_url);
  const stored = {};

  if (remoteVideoUrl) {
    const video = await saveMediaFromUrl(remoteVideoUrl, "video/mp4", "media-video");
    stored.videoUrl = video.url;
    stored.videoBlobUrl = video.blobUrl;
  }

  if (remoteLastFrameUrl) {
    const lastFrame = await saveMediaFromUrl(remoteLastFrameUrl, "image/png", "media-image");
    stored.lastFrameUrl = lastFrame.url;
    stored.lastFrameBlobUrl = lastFrame.blobUrl;
  }

  return stored;
}

export function buildArkTaskPatch(arkTask) {
  const content = arkTask?.content && typeof arkTask.content === "object" ? arkTask.content : {};
  return {
    status: normalizeText(arkTask?.status) || "queued",
    error: arkTask?.error || null,
    usage: arkTask?.usage || null,
    arkResponse: arkTask || null,
    remoteVideoUrl: normalizeText(content.video_url) || null,
    remoteLastFrameUrl: normalizeText(content.last_frame_url) || null,
    arkCreatedAt: getUnixDate(arkTask?.created_at),
    arkUpdatedAt: getUnixDate(arkTask?.updated_at),
  };
}
