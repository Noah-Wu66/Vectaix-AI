import dbConnect from "@/lib/db";
import { getAuthPayload } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rateLimit";
import { buildExportFilename, buildUserExportPayload } from "@/lib/server/data/transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORT_RATE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 };

export async function GET(req) {
  await dbConnect();
  const user = await getAuthPayload();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const clientIP = getClientIP(req);
  const rateLimitKey = `export:${user.userId}:${clientIP}`;
  const { success, resetTime } = rateLimit(rateLimitKey, EXPORT_RATE_LIMIT);
  if (!success) {
    const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
    return Response.json(
      { error: "导出过于频繁，请稍后再试" },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  const payload = await buildUserExportPayload(user.userId);
  const body = JSON.stringify(payload);
  const filename = buildExportFilename();

  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
