import { getClientIP, rateLimit } from "@/lib/rateLimit";
import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import {
  VIDEO_ASPECT_RATIO_OPTIONS,
  VIDEO_DURATION_OPTIONS,
  VIDEO_FRAME_ACCEPTED_MIME_TYPES,
  VIDEO_FRAME_MAX_BYTES,
  VIDEO_MODEL,
  VIDEO_PRIORITY_MAX,
  VIDEO_PRIORITY_MIN,
  VIDEO_PROMPT_MAX_LENGTH,
  VIDEO_RESOLUTION_OPTIONS,
} from "@/lib/media/shared/models";
import VideoGenerationTask from "@/models/VideoGenerationTask";
import {
  buildSafetyIdentifier,
  createArkVideoTask,
} from "@/lib/media/server/ark/videos";
import { serializeVideoTask } from "@/lib/media/server/ark/taskRecords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_TASK_RATE_LIMIT = { limit: 6, windowMs: 60 * 1000 };
const ALLOWED_RATIOS = new Set(VIDEO_ASPECT_RATIO_OPTIONS.map((item) => item.id));
const ALLOWED_DURATIONS = new Set(VIDEO_DURATION_OPTIONS.map((item) => item.id));
const ALLOWED_RESOLUTIONS = new Set(VIDEO_RESOLUTION_OPTIONS.map((item) => item.id));
const ALLOWED_FRAME_MIME_TYPES = new Set(VIDEO_FRAME_ACCEPTED_MIME_TYPES);

function jsonMessage(message, status = 400) {
  return Response.json({ success: false, message }, { status });
}

function getPublicErrorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("ARK_API_KEY")) {
    return "缺少 ARK_API_KEY 环境变量";
  }
  return message || fallback;
}

function readOptionalString(formData, name) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(formData, name, defaultValue) {
  const value = readOptionalString(formData, name);
  if (!value) return defaultValue;
  return value === "true";
}

function readInteger(formData, name, defaultValue) {
  const value = readOptionalString(formData, name);
  if (!value) return defaultValue;
  const number = Number(value);
  return Number.isInteger(number) ? number : NaN;
}

function readOptionalImage(formData, name) {
  const value = formData.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

function validateFrameImage(image, label) {
  if (!image) return "";
  if (!ALLOWED_FRAME_MIME_TYPES.has(image.type)) {
    return `${label}仅支持 PNG、JPG、WEBP 图片`;
  }
  if (image.size > VIDEO_FRAME_MAX_BYTES) {
    return `${label}大小不能超过 25MB`;
  }
  return "";
}

function parseVideoTaskForm(formData) {
  const prompt = readOptionalString(formData, "prompt");
  const ratio = readOptionalString(formData, "ratio") || "adaptive";
  const duration = readInteger(formData, "duration", 5);
  const resolution = readOptionalString(formData, "resolution") || "720p";
  const generateAudio = readBoolean(formData, "generateAudio", true);
  const watermark = readBoolean(formData, "watermark", false);
  const returnLastFrame = readBoolean(formData, "returnLastFrame", false);
  const webSearch = readBoolean(formData, "webSearch", false);
  const priority = readInteger(formData, "priority", 0);
  const image = readOptionalImage(formData, "image");
  const lastFrame = readOptionalImage(formData, "lastFrame");

  if (!prompt && !image) {
    throw new Error("请输入视频描述或上传首帧图片");
  }
  if (prompt.length > VIDEO_PROMPT_MAX_LENGTH) {
    throw new Error(`视频描述最多支持 ${VIDEO_PROMPT_MAX_LENGTH} 个字符`);
  }
  if (!ALLOWED_RATIOS.has(ratio)) {
    throw new Error("不支持的画面比例");
  }
  if (!ALLOWED_DURATIONS.has(duration)) {
    throw new Error("不支持的视频时长");
  }
  if (!ALLOWED_RESOLUTIONS.has(resolution)) {
    throw new Error("不支持的分辨率");
  }
  if (!Number.isInteger(priority) || priority < VIDEO_PRIORITY_MIN || priority > VIDEO_PRIORITY_MAX) {
    throw new Error("优先级必须是 0 到 9 之间的整数");
  }
  if (lastFrame && !image) {
    throw new Error("使用尾帧时需要同时上传首帧");
  }

  const imageError = validateFrameImage(image, "首帧图片");
  if (imageError) throw new Error(imageError);
  const lastFrameError = validateFrameImage(lastFrame, "尾帧图片");
  if (lastFrameError) throw new Error(lastFrameError);

  return {
    prompt,
    ratio,
    duration,
    resolution,
    generateAudio,
    watermark,
    returnLastFrame,
    webSearch,
    priority,
    image,
    lastFrame,
    inputMode: image ? "image" : "text",
  };
}

export async function GET() {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");

    const tasks = await VideoGenerationTask.find({ userId: user.userId })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();

    return Response.json({
      success: true,
      tasks: tasks.map(serializeVideoTask).filter(Boolean),
    });
  } catch (error) {
    console.error("[Media] list video tasks:", error);
    return jsonMessage(getPublicErrorMessage(error, "读取视频任务失败"), 500);
  }
}

export async function POST(request) {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");

    const clientIP = getClientIP(request);
    const rateLimitKey = `media-video:${user.userId}:${clientIP}`;
    const limited = rateLimit(rateLimitKey, VIDEO_TASK_RATE_LIMIT);
    if (!limited.success) {
      return jsonMessage("请求过于频繁，请稍后再试", 429);
    }

    const formData = await request.formData();
    const input = parseVideoTaskForm(formData);
    const safetyIdentifier = buildSafetyIdentifier(user.userId);
    const arkTask = await createArkVideoTask({
      ...input,
      safetyIdentifier,
      signal: request.signal,
    });

    const arkTaskId = typeof arkTask?.id === "string" ? arkTask.id.trim() : "";
    if (!arkTaskId) {
      return jsonMessage("视频生成任务提交失败", 500);
    }

    const task = await VideoGenerationTask.create({
      userId: user.userId,
      arkTaskId,
      status: "queued",
      model: VIDEO_MODEL,
      prompt: input.prompt,
      inputMode: input.inputMode,
      params: {
        ratio: input.ratio,
        duration: input.duration,
        resolution: input.resolution,
        generateAudio: input.generateAudio,
        watermark: input.watermark,
        returnLastFrame: input.returnLastFrame,
        webSearch: input.webSearch,
        priority: input.priority,
        hasFirstFrame: Boolean(input.image),
        hasLastFrame: Boolean(input.lastFrame),
      },
      arkResponse: arkTask,
    });

    return Response.json({
      success: true,
      task: serializeVideoTask(task),
    });
  } catch (error) {
    console.error("[Media] create video task:", error);
    const message = getPublicErrorMessage(error, "视频任务创建失败");
    const status = Number.isInteger(error?.status) && error.status >= 400 ? error.status : 500;
    return jsonMessage(message, status);
  }
}
