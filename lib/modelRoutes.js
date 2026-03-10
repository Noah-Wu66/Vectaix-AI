import SystemConfig from "@/models/SystemConfig";

export const MODEL_ROUTES_CONFIG_KEY = "model_routes";
export const DEFAULT_MODEL_ROUTES = Object.freeze({
  openai: "default",
  opus: "default",
});

const OPENAI_ROUTE_VALUES = new Set(["default", "zenmux"]);
const OPUS_ROUTE_VALUES = new Set(["default", "zenmux"]);

const RIGHT_CODES_OPENAI_BASE_URL =
  process.env.RIGHT_CODES_OPENAI_BASE_URL || "https://www.right.codes/codex/v1";
const RIGHT_CODES_API_KEY = process.env.RIGHT_CODES_API_KEY;
const AIGOCODE_CLAUDE_BASE_URL = "https://api.aigocode.com";
const AIGOCODE_API_KEY = process.env.AIGOCODE_API_KEY;
const ZENMUX_OPENAI_BASE_URL = "https://zenmux.ai/api/v1";
const ZENMUX_ANTHROPIC_BASE_URL = "https://zenmux.ai/api/anthropic";
const ZENMUX_API_KEY = process.env.ZENMUX_API_KEY;

function normalizeOpenAIRoute(value) {
  return OPENAI_ROUTE_VALUES.has(value) ? value : DEFAULT_MODEL_ROUTES.openai;
}

function normalizeOpusRoute(value) {
  return OPUS_ROUTE_VALUES.has(value) ? value : DEFAULT_MODEL_ROUTES.opus;
}

export function normalizeModelRoutes(routes) {
  const src = routes && typeof routes === "object" ? routes : {};
  return {
    openai: normalizeOpenAIRoute(src.openai),
    opus: normalizeOpusRoute(src.opus),
  };
}

export async function getModelRoutes() {
  const config = await SystemConfig.findOne({ key: MODEL_ROUTES_CONFIG_KEY }).lean();
  return normalizeModelRoutes(config?.routes);
}

export async function saveModelRoutes(routes) {
  const normalizedRoutes = normalizeModelRoutes(routes);
  const config = await SystemConfig.findOneAndUpdate(
    { key: MODEL_ROUTES_CONFIG_KEY },
    {
      $set: {
        routes: normalizedRoutes,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        key: MODEL_ROUTES_CONFIG_KEY,
      },
    },
    {
      new: true,
      upsert: true,
    }
  ).lean();

  return normalizeModelRoutes(config?.routes);
}

export function resolveOpenAIProviderConfig(routes) {
  const route = normalizeOpenAIRoute(routes?.openai);
  if (route === "zenmux") {
    if (!ZENMUX_API_KEY) {
      throw new Error("ZENMUX_API_KEY is not set");
    }
    return {
      route,
      baseUrl: ZENMUX_OPENAI_BASE_URL,
      apiKey: ZENMUX_API_KEY,
    };
  }

  if (!RIGHT_CODES_API_KEY) {
    throw new Error("RIGHT_CODES_API_KEY is not set");
  }
  return {
    route,
    baseUrl: RIGHT_CODES_OPENAI_BASE_URL,
    apiKey: RIGHT_CODES_API_KEY,
  };
}

export function resolveOpusProviderConfig(routes) {
  const route = normalizeOpusRoute(routes?.opus);
  if (route === "zenmux") {
    if (!ZENMUX_API_KEY) {
      throw new Error("ZENMUX_API_KEY is not set");
    }
    return {
      route,
      baseUrl: ZENMUX_ANTHROPIC_BASE_URL,
      apiKey: ZENMUX_API_KEY,
    };
  }

  if (!AIGOCODE_API_KEY) {
    throw new Error("AIGOCODE_API_KEY is not set");
  }
  return {
    route,
    baseUrl: AIGOCODE_CLAUDE_BASE_URL,
    apiKey: AIGOCODE_API_KEY,
  };
}
