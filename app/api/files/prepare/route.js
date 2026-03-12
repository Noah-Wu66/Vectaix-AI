import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import { AGENT_MODEL_ID } from "@/lib/shared/models";
import { prepareDocumentAttachment } from "@/lib/server/files/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const auth = await getAuthPayload();
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  if (!url) {
    return Response.json({ error: "缺少文件地址" }, { status: 400 });
  }
  if (model !== AGENT_MODEL_ID) {
    return Response.json({ error: "这类文件目前仅 Agent 支持" }, { status: 403 });
  }

  try {
    await dbConnect();
    const prepared = await prepareDocumentAttachment({
      userId: auth.userId,
      url,
    });
    return Response.json({ file: prepared.file });
  } catch (error) {
    return Response.json({ error: error?.message || "文件解析失败" }, { status: 400 });
  }
}
