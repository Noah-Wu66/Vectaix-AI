export const SEED_MODEL_ID = "doubao-seed-2-0-pro-260215";
export const LEGACY_SEED_MODEL_ID = "volcengine/doubao-seed-2.0-pro";
export const LEGACY_PREFIXED_SEED_MODEL_ID = `volcengine/${SEED_MODEL_ID}`;

export const SEED_REASONING_LEVELS = ["minimal", "low", "medium", "high"];
export const SEED_REASONING_LABELS = {
  minimal: "最小",
  low: "低",
  medium: "中",
  high: "高",
};

export function normalizeSeedModelId(model) {
  if (typeof model !== "string" || !model) return model;
  if (model === LEGACY_SEED_MODEL_ID || model === LEGACY_PREFIXED_SEED_MODEL_ID) {
    return SEED_MODEL_ID;
  }
  return model;
}

export function isSeedModel(model) {
  const normalized = normalizeSeedModelId(model);
  return typeof normalized === "string" && normalized.startsWith("doubao-seed-");
}

