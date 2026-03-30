import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import {
  addUserPrompt,
  deleteUserPrompt,
  getUserSettings,
  updateUserProfileSettings,
  updateUserPrompt,
} from "@/lib/server/settings/service";

async function parseJsonBody(req) {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false };
  }
}

async function requireUser() {
  await dbConnect();
  const user = await getAuthPayload();
  if (!user) {
    return null;
  }
  return user;
}

export async function GET() {
  const user = await requireUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getUserSettings(user.userId);
  return Response.json({ settings });
}

export async function POST(req) {
  const user = await requireUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return Response.json({ error: "请求体格式错误" }, { status: 400 });

  try {
    const settings = await addUserPrompt(user.userId, parsed.body || {});
    return Response.json({ settings });
  } catch (error) {
    return Response.json({ error: error?.message || "保存失败" }, { status: 400 });
  }
}

export async function DELETE(req) {
  const user = await requireUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return Response.json({ error: "请求体格式错误" }, { status: 400 });

  try {
    const settings = await deleteUserPrompt(user.userId, parsed.body?.promptId);
    return Response.json({ settings });
  } catch (error) {
    const status = error?.message === "Settings not found" || error?.message === "Prompt not found" ? 404 : 400;
    return Response.json({ error: error?.message || "删除失败" }, { status });
  }
}

export async function PUT(req) {
  const user = await requireUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return Response.json({ error: "请求体格式错误" }, { status: 400 });

  try {
    const settings = await updateUserProfileSettings(user.userId, parsed.body || {});
    return Response.json({ settings });
  } catch (error) {
    return Response.json({ error: error?.message || "更新失败" }, { status: 400 });
  }
}

export async function PATCH(req) {
  const user = await requireUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return Response.json({ error: "请求体格式错误" }, { status: 400 });

  try {
    const settings = await updateUserPrompt(user.userId, parsed.body || {});
    return Response.json({ settings });
  } catch (error) {
    const status = error?.message === "Settings not found" || error?.message === "Prompt not found" ? 404 : 400;
    return Response.json({ error: error?.message || "更新失败" }, { status });
  }
}
