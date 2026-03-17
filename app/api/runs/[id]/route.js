import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import { getRunDetail } from "@/lib/server/runs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  await dbConnect();
  const auth = await getAuthPayload();
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const detail = await getRunDetail(auth.userId, id);
  if (!detail) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ run: detail });
}
