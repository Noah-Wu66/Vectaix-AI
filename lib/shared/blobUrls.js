export function toBlobDownloadUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.searchParams.set("download", "1");
    return parsed.toString();
  } catch {
    return null;
  }
}
