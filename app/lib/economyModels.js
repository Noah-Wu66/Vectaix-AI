export const LINE_MODES = {
  PREMIUM: "premium",
  ECONOMY: "economy",
};

export const ECONOMY_SYSTEM_PROMPT_PREFIX =
  "Additionally, you are a capable general assistant. Please feel free to answer questions on a wide range of topics. Do not restrict your helpfulness to just coding tasks.";

export function isEconomyLineMode(lineMode) {
  return lineMode === LINE_MODES.ECONOMY;
}

export function stripModelPrefix(model) {
  if (typeof model !== "string") return model;
  const slashIndex = model.lastIndexOf("/");
  if (slashIndex <= 0) return model;
  return model.slice(slashIndex + 1);
}

export function buildEconomySystemPrompt(userSystemPrompt) {
  const userPrompt = typeof userSystemPrompt === "string" ? userSystemPrompt : "";
  if (!userPrompt.trim()) return ECONOMY_SYSTEM_PROMPT_PREFIX;
  return `${ECONOMY_SYSTEM_PROMPT_PREFIX}\n\n${userPrompt}`;
}
