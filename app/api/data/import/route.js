import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rateLimit";
import { importUserData } from "@/lib/server/data/transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMPORT_RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 };

export async function POST(req) {
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > 2_000_000) {
    return Response.json({ error: "Request too large" }, { status: 413 });
  }

  await dbConnect();
  const user = await getAuthPayload();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const clientIP = getClientIP(req);
  const rateLimitKey = `import:${user.userId}:${clientIP}`;
  const { success, resetTime } = rateLimit(rateLimitKey, IMPORT_RATE_LIMIT);
  if (!success) {
    const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
    return Response.json(
      { error: "导入过于频繁，请稍后再试" },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const imported = await importUserData(user.userId, payload);
    return Response.json({ success: true, imported });
  } catch (error) {
    const status = /schemaVersion|Missing data|Body must be|data\.conversations|Too many conversations|invalid|too long|required|must be/.test(error?.message || "")
      ? 400
      : 500;
    if (status === 500) {
      console.error("Import transaction failed:", error?.message);
    }
    return Response.json({ error: status === 400 ? error?.message : "Import failed" }, { status });
  }
}
