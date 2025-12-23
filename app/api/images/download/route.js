import { getAuthPayload } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function pickFilenameFromUrl(url, fallbackExt = "png") {
  try {
    const u = new URL(url);
    const raw = u.pathname.split("/").filter(Boolean).pop() || "";
    const cleaned = raw.replace(/[^\w.\-]/g, "").slice(0, 128);
    if (cleaned && cleaned.includes(".")) return cleaned;
    if (cleaned) return `${cleaned}.${fallbackExt}`;
  } catch {
    // ignore
  }
  return `image.${fallbackExt}`;
}

function extFromContentType(contentType) {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  if (ct === "image/jpeg") return "jpg";
  if (ct === "image/png") return "png";
  if (ct === "image/webp") return "webp";
  if (ct === "image/gif") return "gif";
  return "png";
}

export async function GET(req) {
  const auth = await getAuthPayload();
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
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

  const upstream = await fetch(url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: "Failed to fetch image" },
      { status: upstream.status || 502 }
    );
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const ext = extFromContentType(contentType);
  const filename = pickFilenameFromUrl(url, ext);

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  const len = upstream.headers.get("content-length");
  if (isNonEmptyString(len)) headers.set("Content-Length", len);
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);

  return new Response(upstream.body, { headers });
}


