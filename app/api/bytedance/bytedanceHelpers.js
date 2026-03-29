import {
  fetchBlobAsBase64,
  fetchImageAsBase64,
  isNonEmptyString,
  getStoredPartsFromMessage,
} from "@/app/api/chat/utils";
import { buildAttachmentTextBlock } from "@/lib/server/files/service";
import { getAttachmentInputType } from "@/lib/shared/attachments";

export function buildSeedMessageInput({ role, content }) {
  if (!isNonEmptyString(role) || !Array.isArray(content) || content.length === 0) {
    return null;
  }

  return {
    type: "message",
    status: "completed",
    role,
    content,
  };
}

export async function storedPartToBytedancePart(part, role, options = {}) {
  if (!part || typeof part !== "object") return null;

  const isAssistant = role === "assistant" || role === "model";

  if (isNonEmptyString(part.text)) {
    return isAssistant
      ? { type: "output_text", text: part.text }
      : { type: "input_text", text: part.text };
  }

  if (!isAssistant) {
    const url = part?.inlineData?.url;
    if (isNonEmptyString(url)) {
      const { base64Data } = await fetchImageAsBase64(url);
      const mimeType = part.inlineData?.mimeType;
      return {
        type: "input_image",
        image_url: `data:${mimeType};base64,${base64Data}`,
      };
    }

    const fileUrl = part?.fileData?.url;
    if (isNonEmptyString(fileUrl)) {
      const inputType = getAttachmentInputType(part?.fileData?.category);
      if (inputType === "video") {
        const { base64Data, mimeType: fetchedMimeType } = await fetchBlobAsBase64(fileUrl, { resourceLabel: "video" });
        const mimeType = part.fileData?.mimeType || fetchedMimeType;
        return {
          type: "input_video",
          video_url: `data:${mimeType};base64,${base64Data}`,
        };
      }

      if (inputType === "audio") {
        const { base64Data, mimeType: fetchedMimeType } = await fetchBlobAsBase64(fileUrl, { resourceLabel: "audio" });
        const mimeType = part.fileData?.mimeType || fetchedMimeType;
        return {
          type: "input_audio",
          audio_url: `data:${mimeType};base64,${base64Data}`,
        };
      }

      const fileTextMap = options?.fileTextMap instanceof Map ? options.fileTextMap : new Map();
      const prepared = fileTextMap.get(fileUrl);
      if (prepared?.structuredText || prepared?.extractedText) {
        return {
          type: "input_text",
          text: buildAttachmentTextBlock(prepared.file || part.fileData, prepared.structuredText || prepared.extractedText),
        };
      }
    }
  }

  return null;
}

export async function buildBytedanceInputFromHistory(messages, options = {}) {
  const input = [];
  for (const msg of messages) {
    if (msg?.role !== "user" && msg?.role !== "model") continue;

    const storedParts = getStoredPartsFromMessage(msg);
    if (!storedParts || storedParts.length === 0) continue;

    const role = msg.role === "model" ? "assistant" : "user";
    const content = [];
    for (const storedPart of storedParts) {
      const p = await storedPartToBytedancePart(storedPart, role, options);
      if (p) content.push(p);
    }
    if (content.length) {
      const messageInput = buildSeedMessageInput({ role, content });
      if (messageInput) input.push(messageInput);
    }
  }
  return input;
}
