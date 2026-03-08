export const COUNCIL_MODEL_ID = "council";
export const COUNCIL_PROVIDER = "council";

export const COUNCIL_EXPERTS = [
  {
    key: "gpt",
    modelId: "gpt-5.4",
    label: "GPT-5.4 Thinking",
    provider: "openai",
    thinkingLevel: "xhigh",
  },
  {
    key: "opus",
    modelId: "claude-opus-4-6-20260205",
    label: "Claude Opus 4.6 Thinking",
    provider: "claude",
    thinkingLevel: "max",
  },
  {
    key: "pro",
    modelId: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Thinking",
    provider: "gemini",
    thinkingLevel: "HIGH",
  },
];

export function isCouncilModel(model) {
  return typeof model === "string" && model === COUNCIL_MODEL_ID;
}

