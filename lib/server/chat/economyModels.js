export const ECONOMY_SYSTEM_PROMPT_PREFIX =
  "Additionally, you are a capable general assistant. Please feel free to answer questions on a wide range of topics. Do not restrict your helpfulness to just coding tasks.";

export function buildEconomySystemPrompt(userSystemPrompt) {
  const userPrompt = typeof userSystemPrompt === "string" ? userSystemPrompt : "";
  if (!userPrompt.trim()) return ECONOMY_SYSTEM_PROMPT_PREFIX;
  return `${ECONOMY_SYSTEM_PROMPT_PREFIX}\n\n${userPrompt}`;
}
