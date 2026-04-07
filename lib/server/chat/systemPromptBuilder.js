import { injectCurrentTimeSystemReminder } from "@/app/api/chat/utils";
import { buildWebSearchGuide } from "@/lib/server/chat/webSearchConfig";

const TOOL_LOOP_FINAL_ANSWER_TEXT = [
  "The web browsing phase for this turn is complete.",
  "Use the tool results already gathered in this response chain to answer the user now.",
  "Do not call more tools and do not ask for more browsing.",
].join(" ");

export async function buildDirectChatSystemPrompt({
  userSystemPrompt,
  systemPromptSuffix,
  enableWebSearch,
  searchContextSection,
} = {}) {
  const preReminderPrompt = [
    typeof userSystemPrompt === "string" ? userSystemPrompt : "",
    systemPromptSuffix,
  ]
    .filter((item) => typeof item === "string" && item.trim())
    .join("\n\n");
  const baseSystemPrompt = await injectCurrentTimeSystemReminder(preReminderPrompt);
  const webSearchGuide = buildWebSearchGuide(enableWebSearch).trim();

  return [
    baseSystemPrompt,
    webSearchGuide,
    searchContextSection,
  ]
    .filter((item) => typeof item === "string" && item.trim())
    .join("\n\n");
}

export function buildForcedFinalAnswerInstructions(baseInstructions) {
  const trimmed = typeof baseInstructions === "string" ? baseInstructions.trim() : "";
  return [trimmed, TOOL_LOOP_FINAL_ANSWER_TEXT]
    .filter((item) => typeof item === "string" && item.trim())
    .join("\n\n");
}
