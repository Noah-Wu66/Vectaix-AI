import { CLAUDE_OPUS_MODEL } from "./claudeModel";
import { GEMINI_PRO_MODEL } from "./geminiModel";
import { OPENAI_PRIMARY_MODEL } from "./openaiModel";

export const COUNCIL_MODEL_ID = "council";
export const COUNCIL_PROVIDER = "council";

export const COUNCIL_EXPERTS = [
  {
    key: "gpt",
    modelId: OPENAI_PRIMARY_MODEL,
    label: "GPT",
    provider: "openai",
    thinkingLevel: "xhigh",
  },
  {
    key: "opus",
    modelId: CLAUDE_OPUS_MODEL,
    label: "Opus",
    provider: "claude",
    thinkingLevel: "max",
  },
  {
    key: "pro",
    modelId: GEMINI_PRO_MODEL,
    label: "Pro",
    provider: "gemini",
    thinkingLevel: "HIGH",
  },
];

export function isCouncilModel(model) {
  return typeof model === "string" && model === COUNCIL_MODEL_ID;
}
