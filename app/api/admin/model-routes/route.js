import dbConnect from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import {
  getModelRoutes,
  normalizeModelRoutes,
  saveModelRoutes,
} from "@/lib/modelRoutes";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return Response.json({ error: "无权限" }, { status: 403 });
  }

  await dbConnect();
  const routes = await getModelRoutes();
  return Response.json({ routes });
}

export async function PATCH(req) {
  const admin = await requireAdmin();
  if (!admin) {
    return Response.json({ error: "无权限" }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体格式错误" }, { status: 400 });
  }

  if (!isPlainObject(body)) {
    return Response.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const normalizedRoutes = normalizeModelRoutes(body);
  if (normalizedRoutes.openai !== body.openai || normalizedRoutes.opus !== body.opus) {
    return Response.json({ error: "线路值无效" }, { status: 400 });
  }

  await dbConnect();
  const routes = await saveModelRoutes(normalizedRoutes);
  return Response.json({ routes });
}
