export const COUNCIL_MODEL_ID = "council";
export const COUNCIL_PROVIDER = "council";

export const COUNCIL_EXPERTS = [
  {
    key: "gpt",
    modelId: "gpt-5.2",
    label: "GPT",
    provider: "openai",
    thinkingLevel: "xhigh",
  },
  {
    key: "opus",
    modelId: "claude-opus-4-6-20260205",
    label: "Opus",
    provider: "claude",
    thinkingLevel: "max",
  },
  {
    key: "pro",
    modelId: "gemini-3.1-pro-preview",
    label: "Pro",
    provider: "gemini",
    thinkingLevel: "HIGH",
  },
];

export function isCouncilModel(model) {
  return typeof model === "string" && model === COUNCIL_MODEL_ID;
}
