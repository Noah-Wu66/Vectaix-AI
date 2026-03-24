import BlobFile from "@/models/BlobFile";
import { normalizeBlobFileId } from "@/lib/shared/blobFileIds";

function collectBlobUrlsFromParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return [];
  const urls = new Set();
  for (const part of parts) {
    const imageUrl = typeof part?.inlineData?.url === "string" ? part.inlineData.url.trim() : "";
    if (imageUrl) urls.add(imageUrl);
    const fileUrl = typeof part?.fileData?.url === "string" ? part.fileData.url.trim() : "";
    if (fileUrl) urls.add(fileUrl);
  }
  return Array.from(urls);
}

async function loadBlobIdMapByUrls({ userId, urls }) {
  const normalizedUrls = Array.from(new Set(
    (Array.isArray(urls) ? urls : []).filter((item) => typeof item === "string" && item.trim())
  ));
  if (!userId || normalizedUrls.length === 0) return new Map();

  const rows = await BlobFile.find({
    userId,
    url: { $in: normalizedUrls },
  })
    .select("_id url")
    .lean();

  return new Map(
    rows
      .filter((row) => row?.url && row?._id)
      .map((row) => [row.url, String(row._id)])
  );
}

export async function enrichConversationPartsWithBlobIds(parts, { userId } = {}) {
  if (!Array.isArray(parts) || parts.length === 0) return [];

  const blobIdMap = await loadBlobIdMapByUrls({
    userId,
    urls: collectBlobUrlsFromParts(parts),
  });

  return parts.map((part) => {
    if (!part || typeof part !== "object") return part;
    const nextPart = { ...part };

    if (part.inlineData && typeof part.inlineData === "object") {
      const url = typeof part.inlineData.url === "string" ? part.inlineData.url.trim() : "";
      const blobFileId = blobIdMap.get(url) || normalizeBlobFileId(part.inlineData.blobFileId);
      nextPart.inlineData = blobFileId
        ? { ...part.inlineData, blobFileId }
        : { ...part.inlineData };
    }

    if (part.fileData && typeof part.fileData === "object") {
      const url = typeof part.fileData.url === "string" ? part.fileData.url.trim() : "";
      const blobFileId = blobIdMap.get(url) || normalizeBlobFileId(part.fileData.blobFileId);
      nextPart.fileData = blobFileId
        ? { ...part.fileData, blobFileId }
        : { ...part.fileData };
    }

    return nextPart;
  });
}

export async function enrichStoredMessagesWithBlobIds(messages, { userId } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const allUrls = new Set();
  for (const message of messages) {
    for (const url of collectBlobUrlsFromParts(message?.parts)) {
      allUrls.add(url);
    }
  }

  const blobIdMap = await loadBlobIdMapByUrls({
    userId,
    urls: Array.from(allUrls),
  });

  return messages.map((message) => {
    if (!message || typeof message !== "object" || !Array.isArray(message.parts)) {
      return message;
    }

    return {
      ...message,
      parts: message.parts.map((part) => {
        if (!part || typeof part !== "object") return part;
        const nextPart = { ...part };

        if (part.inlineData && typeof part.inlineData === "object") {
          const url = typeof part.inlineData.url === "string" ? part.inlineData.url.trim() : "";
          const blobFileId = blobIdMap.get(url) || normalizeBlobFileId(part.inlineData.blobFileId);
          nextPart.inlineData = blobFileId
            ? { ...part.inlineData, blobFileId }
            : { ...part.inlineData };
        }

        if (part.fileData && typeof part.fileData === "object") {
          const url = typeof part.fileData.url === "string" ? part.fileData.url.trim() : "";
          const blobFileId = blobIdMap.get(url) || normalizeBlobFileId(part.fileData.blobFileId);
          nextPart.fileData = blobFileId
            ? { ...part.fileData, blobFileId }
            : { ...part.fileData };
        }

        return nextPart;
      }),
    };
  });
}
