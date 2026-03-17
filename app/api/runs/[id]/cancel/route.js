import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import ChatRun from "@/models/ChatRun";
import { cancelChatRun } from "@/lib/server/runs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, context) {
  await dbConnect();
  const auth = await getAuthPayload();
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const run = await ChatRun.findOne({ _id: id, userId: auth.userId });
  if (!run) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const nextRun = await cancelChatRun(run);
  return Response.json({
    success: true,
    run: nextRun
      ? {
          runId: nextRun._id.toString(),
          runType: "chat",
          conversationId: nextRun.conversationId.toString(),
          messageId: nextRun.messageId,
          status: nextRun.status,
          phase: nextRun.phase,
          model: nextRun.model,
          provider: nextRun.provider,
          updatedAt: nextRun.updatedAt?.toISOString?.() || null,
        }
      : null,
  });
}
