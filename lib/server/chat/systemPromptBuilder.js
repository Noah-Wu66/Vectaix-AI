import { injectCurrentTimeSystemReminder } from "@/app/api/chat/utils";
import { buildEconomySystemPrompt } from "@/lib/server/chat/economyModels";
import { buildWebSearchGuide } from "@/lib/server/chat/webSearchConfig";

export const DIRECT_CHAT_FORMATTING_GUARD = "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";

export async function buildDirectChatSystemPrompt({
  userSystemPrompt,
  systemPromptSuffix,
  enableWebSearch,
  searchContextSection,
  includeEconomyPrefix = false,
} = {}) {
  const preReminderPrompt = [
    includeEconomyPrefix
      ? buildEconomySystemPrompt(userSystemPrompt)
      : (typeof userSystemPrompt === "string" ? userSystemPrompt : ""),
    systemPromptSuffix,
  ]
    .filter((item) => typeof item === "string" && item.trim())
    .join("\n\n");
  const baseSystemPrompt = await injectCurrentTimeSystemReminder(preReminderPrompt);
  const webSearchGuide = buildWebSearchGuide(enableWebSearch).trim();

  return [
    baseSystemPrompt,
    DIRECT_CHAT_FORMATTING_GUARD,
    webSearchGuide,
    searchContextSection,
  ]
    .filter((item) => typeof item === "string" && item.trim())
    .join("\n\n");
}
