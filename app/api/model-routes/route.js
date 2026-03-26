import { getCurrentUserWithAccess } from "@/lib/admin";
import {
  getModelRoutes,
  normalizeModelRoutes,
  saveModelRoutes,
} from "@/lib/modelRoutes";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildUnauthorizedResponse() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUserWithAccess();
  if (!user) {
    return buildUnauthorizedResponse();
  }

  const routes = await getModelRoutes(user.userId);
  return Response.json({ routes });
}

export async function PATCH(req) {
  const user = await getCurrentUserWithAccess();
  if (!user) {
    return buildUnauthorizedResponse();
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
  if (
    normalizedRoutes.openai !== body.openai ||
    normalizedRoutes.anthropic !== body.anthropic ||
    normalizedRoutes.gemini !== body.gemini
  ) {
    return Response.json({ error: "线路值无效" }, { status: 400 });
  }

  const routes = await saveModelRoutes(user.userId, normalizedRoutes);
  return Response.json({ routes });
}
