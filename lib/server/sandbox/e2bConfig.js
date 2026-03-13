export const DEFAULT_E2B_TEMPLATE_REF = "vectaix-agent";
export const DEFAULT_E2B_TEMPLATE_VERSION = "prod";

export function getConfiguredE2BTemplateRef() {
  return process.env.E2B_TEMPLATE || DEFAULT_E2B_TEMPLATE_REF;
}

export function getConfiguredE2BTemplateVersion() {
  return process.env.E2B_TEMPLATE_VERSION || DEFAULT_E2B_TEMPLATE_VERSION;
}

export function hasE2BApiKey() {
  return Boolean(process.env.E2B_API_KEY);
}

export function assertE2BApiKey() {
  if (!hasE2BApiKey()) {
    throw new Error("E2B_API_KEY 未配置");
  }
}
