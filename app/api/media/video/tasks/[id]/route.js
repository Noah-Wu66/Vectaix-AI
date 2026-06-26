import mongoose from "mongoose";
import {
  requireUserRecord,
  unauthorizedResponse,
} from "@/lib/server/api/routeHelpers";
import VideoGenerationTask from "@/models/VideoGenerationTask";
import { deleteArkVideoTask } from "@/lib/media/server/ark/videos";
import {
  serializeVideoTask,
  shouldSyncVideoTask,
  syncVideoTaskRecord,
} from "@/lib/media/server/ark/taskRecords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMOTE_DELETE_STATUSES = new Set(["succeeded", "failed", "expired"]);

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

async function getTaskId(context) {
  const params = await context?.params;
  return typeof params?.id === "string" ? params.id.trim() : "";
}

async function loadOwnedTask(id, userId) {
  if (!mongoose.isValidObjectId(id)) return null;
  return VideoGenerationTask.findOne({ _id: id, userId });
}

export async function GET(request, context) {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");

    const id = await getTaskId(context);
    let task = await loadOwnedTask(id, user.userId);
    if (!task) {
      return jsonMessage("任务不存在", 404);
    }

    if (shouldSyncVideoTask(task)) {
      task = await syncVideoTaskRecord(task, { signal: request.signal });
    } else {
      task = task.toObject();
    }

    return Response.json({
      success: true,
      task: serializeVideoTask(task),
    });
  } catch (error) {
    console.error("[Media] get video task:", error);
    const message = getPublicErrorMessage(error, "查询视频任务失败");
    const status = Number.isInteger(error?.status) && error.status >= 400 ? error.status : 500;
    return jsonMessage(message, status);
  }
}

export async function DELETE(request, context) {
  try {
    const auth = await requireUserRecord({ connectDb: true, select: null });
    const user = auth?.payload;
    if (!user) return unauthorizedResponse("未登录");

    const id = await getTaskId(context);
    const task = await loadOwnedTask(id, user.userId);
    if (!task) {
      return jsonMessage("任务不存在", 404);
    }

    if (task.status === "running") {
      return jsonMessage("运行中的任务不能取消或删除", 409);
    }

    if (task.status === "queued") {
      await deleteArkVideoTask(task.arkTaskId, { signal: request.signal });
      const updatedTask = await VideoGenerationTask.findOneAndUpdate(
        { _id: task._id, userId: user.userId },
        { $set: { status: "cancelled", error: null } },
        { new: true }
      ).lean();
      return Response.json({
        success: true,
        task: serializeVideoTask(updatedTask),
      });
    }

    if (REMOTE_DELETE_STATUSES.has(task.status)) {
      await deleteArkVideoTask(task.arkTaskId, { signal: request.signal });
      await VideoGenerationTask.deleteOne({ _id: task._id, userId: user.userId });
      return Response.json({ success: true, deleted: true });
    }

    if (task.status === "cancelled") {
      await VideoGenerationTask.deleteOne({ _id: task._id, userId: user.userId });
      return Response.json({ success: true, deleted: true });
    }

    return jsonMessage("当前任务状态不支持该操作", 400);
  } catch (error) {
    console.error("[Media] delete video task:", error);
    const message = getPublicErrorMessage(error, "处理视频任务失败");
    const status = Number.isInteger(error?.status) && error.status >= 400 ? error.status : 500;
    return jsonMessage(message, status);
  }
}
