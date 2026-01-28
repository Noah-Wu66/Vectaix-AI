import {
  fetchImageAsBase64,
  isNonEmptyString,
  getStoredPartsFromMessage,
} from "@/app/api/chat/utils";

export async function storedPartToOpenAIPart(part, role) {
  if (!part || typeof part !== "object") return null;

  // assistant 角色使用 output_text，user 角色使用 input_text
  const isAssistant = role === "assistant" || role === "model";

  if (isNonEmptyString(part.text)) {
    return isAssistant
      ? { type: "output_text", text: part.text }
      : { type: "input_text", text: part.text };
  }

  // 图片只对 user 角色有效
  if (!isAssistant) {
    const url = part?.inlineData?.url;
    if (isNonEmptyString(url)) {
      const { base64Data, mimeType: fetchedMimeType } =
        await fetchImageAsBase64(url);
      const mimeType = part.inlineData?.mimeType || fetchedMimeType;
      return {
        type: "input_image",
        image_url: `data:${mimeType};base64,${base64Data}`,
      };
    }
  }

  return null;
}

export async function buildOpenAIInputFromHistory(messages) {
  const input = [];
  for (const msg of messages || []) {
    if (msg?.role !== "user" && msg?.role !== "model") continue;

    const storedParts = getStoredPartsFromMessage(msg);
    if (!storedParts || storedParts.length === 0) continue;

    const openaiRole = msg.role === "model" ? "assistant" : "user";
    const content = [];
    for (const storedPart of storedParts) {
      const p = await storedPartToOpenAIPart(storedPart, openaiRole);
      if (p) content.push(p);
    }
    if (content.length) {
      input.push({ role: openaiRole, content });
    }
  }
  return input;
}

function extractJsonObject(text) {
  if (typeof text !== "string") return null;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return text.slice(first, last + 1);
}

export function parseJsonFromText(text) {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}
