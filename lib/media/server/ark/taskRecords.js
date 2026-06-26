import VideoGenerationTask from "@/models/VideoGenerationTask";
import {
  ARK_VIDEO_ACTIVE_STATUSES,
  buildArkTaskPatch,
  getArkVideoTask,
  storeArkVideoOutput,
} from "@/lib/media/server/ark/videos";

const CLIENT_ARK_FIELDS = [
  "resolution",
  "ratio",
  "duration",
  "frames",
  "framespersecond",
  "generate_audio",
  "priority",
  "service_tier",
  "tools",
  "usage",
];

function normalizeObject(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.toObject === "function") return value.toObject();
  return value;
}

function pickArkSummary(arkResponse) {
  const source = normalizeObject(arkResponse);
  if (!source) return null;
  const summary = {};
  for (const key of CLIENT_ARK_FIELDS) {
    if (source[key] !== undefined) {
      summary[key] = source[key];
    }
  }
  return Object.keys(summary).length > 0 ? summary : null;
}

export function serializeVideoTask(task) {
  const item = normalizeObject(task);
  if (!item) return null;

  return {
    id: String(item._id || item.id || ""),
    arkTaskId: item.arkTaskId || "",
    status: item.status || "queued",
    model: item.model || "",
    prompt: item.prompt || "",
    inputMode: item.inputMode || "text",
    params: item.params || {},
    error: item.error || null,
    usage: item.usage || null,
    ark: pickArkSummary(item.arkResponse),
    videoUrl: item.videoUrl || "",
    lastFrameUrl: item.lastFrameUrl || "",
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    arkCreatedAt: item.arkCreatedAt || null,
    arkUpdatedAt: item.arkUpdatedAt || null,
  };
}

export function shouldSyncVideoTask(task) {
  const item = normalizeObject(task);
  if (!item) return false;
  if (ARK_VIDEO_ACTIVE_STATUSES.has(item.status)) return true;
  return item.status === "succeeded" && !item.videoUrl;
}

export async function syncVideoTaskRecord(task, { signal } = {}) {
  const item = normalizeObject(task);
  const arkTask = await getArkVideoTask(item.arkTaskId, { signal });
  const patch = buildArkTaskPatch(arkTask);

  if (patch.status === "succeeded" && !item.videoUrl) {
    const storedOutput = await storeArkVideoOutput(arkTask);
    Object.assign(patch, storedOutput);
  }

  return VideoGenerationTask.findByIdAndUpdate(
    item._id,
    { $set: patch },
    { new: true }
  ).lean();
}
