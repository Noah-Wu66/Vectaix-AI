import dbConnect from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import AgentRun from "@/models/AgentRun";
import {
  getSandboxProvider,
  getSandboxRuntime,
  killSandboxSession,
} from "@/lib/server/sandbox/vercelSandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getCurrentSession(userId) {
  const run = await AgentRun.findOne({
    userId,
    "sandboxSession.sandboxId": { $exists: true, $ne: "" },
  })
    .sort({ updatedAt: -1 })
    .select("sandboxSession status executionState updatedAt");

  if (!run?.sandboxSession?.sandboxId) return null;
  return {
    sandboxId: run.sandboxSession.sandboxId,
    status: run.sandboxSession.status || run.status || "running",
    workdir: run.sandboxSession.workdir || "",
    lastConnectedAt: run.sandboxSession.lastConnectedAt || run.updatedAt || null,
    executionState: run.executionState || "",
  };
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return Response.json({ error: "无权限" }, { status: 403 });
  }

  await dbConnect();

  return Response.json({
    provider: "Vercel Sandbox",
    providerId: getSandboxProvider(),
    agentRuntime: getSandboxRuntime("agent"),
    parserRuntime: getSandboxRuntime("parser"),
    currentSession: await getCurrentSession(admin.userId),
  });
}

export async function POST() {
  const admin = await requireAdmin();
  if (!admin) {
    return Response.json({ error: "无权限" }, { status: 403 });
  }

  await dbConnect();
  const run = await AgentRun.findOne({
    userId: admin.userId,
    "sandboxSession.sandboxId": { $exists: true, $ne: "" },
  }).sort({ updatedAt: -1 });

  if (!run?.sandboxSession?.sandboxId) {
    return Response.json({
      success: true,
      message: "当前账号没有需要重置的 Agent 会话",
      currentSession: null,
    });
  }

  await killSandboxSession(run.sandboxSession).catch(() => {});
  await AgentRun.updateOne(
    { _id: run._id },
    {
      $set: {
        sandboxSession: null,
        updatedAt: new Date(),
      },
    }
  );

  return Response.json({
    success: true,
    message: "当前 Agent 会话已重置，下次执行会自动创建新的 Vercel Sandbox",
    currentSession: null,
  });
}
