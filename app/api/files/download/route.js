import { getAuthPayload } from "@/lib/auth";
import { rateLimit, getClientIP } from "@/lib/rateLimit";
import dbConnect from "@/lib/db";
import Conversation from "@/models/Conversation";
import UserSettings from "@/models/UserSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_DOMAINS = [
  "blob.vercel-storage.com",
  "public.blob.vercel-storage.com",
];

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isAllowedDomain(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith("." + domain)
    );
  } catch {
    return false;
  }
}

function pickFilenameFromUrl(url, fallbackName) {
  try {
    const u = new URL(url);
    const raw = u.pathname.split("/").filter(Boolean).pop();
    const cleaned = raw.replace(/[^\w.\-]/g, "").slice(0, 128);
    if (cleaned) return cleaned;
  } catch {
    // ignore
  }
  return fallbackName || "download.bin";
}

async function isUrlOwnedByUser(userId, url) {
  const conversationMatch = await Conversation.exists({
    userId,
    $or: [
      { "messages.parts.inlineData.url": url },
      { "messages.parts.fileData.url": url },
    ],
  });
  if (conversationMatch) return true;

  const settingsMatch = await UserSettings.exists({ userId, avatar: url });
  return Boolean(settingsMatch);
}

export async function GET(req) {
  const auth = await getAuthPayload();
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit: 100 downloads per hour per user
  const clientIP = getClientIP(req);
  const rlKey = `download:${auth.userId}:${clientIP}`;
  const { success: rlOk, resetTime } = await rateLimit(rlKey, { limit: 100, windowMs: 60 * 60 * 1000 });
  if (!rlOk) {
    const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
    return Response.json(
      { error: "下载过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  const name = searchParams.get("name");
  if (!isNonEmptyString(url)) {
    return Response.json({ error: "Missing url" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: "Invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return Response.json({ error: "Invalid url protocol" }, { status: 400 });
  }

  if (!isAllowedDomain(url)) {
    return Response.json(
      { error: "Domain not allowed for security reasons" },
      { status: 403 }
    );
  }

  try {
    await dbConnect();
    const owned = await isUrlOwnedByUser(auth.userId, url);
    if (!owned) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch (error) {
    console.error("Failed to verify file ownership:", error?.message);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }

  let upstream;
  try {
    upstream = await fetch(url, { cache: "no-store" });
  } catch {
    return Response.json({ error: "Failed to fetch file" }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: "Failed to fetch file" },
      { status: upstream.status }
    );
  }

  const contentType = upstream.headers.get("content-type");
  const filename = pickFilenameFromUrl(url, name);

  const headers = new Headers();
  headers.set("Content-Type", isNonEmptyString(contentType) ? contentType : "application/octet-stream");
  const len = upstream.headers.get("content-length");
  if (isNonEmptyString(len)) headers.set("Content-Length", len);
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(upstream.body, { headers });
}
