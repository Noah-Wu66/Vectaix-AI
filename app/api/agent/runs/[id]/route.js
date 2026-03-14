import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import AgentRun from "@/models/AgentRun";
import { buildAgentMessageMeta } from "@/lib/server/agent/runHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req, context) {
  await dbConnect();
  const auth = await getAuthPayload();
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const run = await AgentRun.findOne({ _id: id, userId: auth.userId });
  if (!run) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({
    run: {
      ...buildAgentMessageMeta(run),
      planSnapshot: run.planSnapshot || null,
      approvalRequest: run.approvalRequest || null,
      contextSnapshot: run.contextSnapshot || null,
    },
  });
}
