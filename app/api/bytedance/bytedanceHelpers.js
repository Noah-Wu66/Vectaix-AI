import {
  fetchImageAsBase64,
  isNonEmptyString,
  getStoredPartsFromMessage,
} from "@/app/api/chat/utils";

export async function storedPartToBytedancePart(part, role) {
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
  }

  return null;
}

export async function buildBytedanceInputFromHistory(messages) {
  const input = [];
  for (const msg of messages) {
    if (msg?.role !== "user" && msg?.role !== "model") continue;

    const storedParts = getStoredPartsFromMessage(msg);
    if (!storedParts || storedParts.length === 0) continue;

    const role = msg.role === "model" ? "assistant" : "user";
    const content = [];
    for (const storedPart of storedParts) {
      const p = await storedPartToBytedancePart(storedPart, role);
      if (p) content.push(p);
    }
    if (content.length) {
      input.push({ role, content });
    }
  }
  return input;
}
