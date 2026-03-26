import dbConnect from "@/lib/db";
import UserSettings from "@/models/UserSettings";

export const DEFAULT_MODEL_ROUTES = Object.freeze({
  openai: "official",
  anthropic: "official",
  gemini: "official",
});

const ROUTE_VALUES = new Set(["official", "openrouter"]);
const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
const MODEL_ROUTES_VERSION = 2;
let modelRoutesResetPromise = null;

function normalizeRoute(value, fallback) {
  return ROUTE_VALUES.has(value) ? value : fallback;
}

function buildDefaultRoutes() {
  return normalizeModelRoutes(DEFAULT_MODEL_ROUTES);
}

async function runModelRoutesReset() {
  await UserSettings.updateMany(
    {
      modelRoutesVersion: { $ne: MODEL_ROUTES_VERSION },
    },
    {
      $set: {
        modelRoutes: buildDefaultRoutes(),
        modelRoutesVersion: MODEL_ROUTES_VERSION,
        updatedAt: new Date(),
      },
    }
  );
}

async function ensureModelRoutesReset() {
  if (!modelRoutesResetPromise) {
    modelRoutesResetPromise = runModelRoutesReset().catch((error) => {
      modelRoutesResetPromise = null;
      throw error;
    });
  }
  await modelRoutesResetPromise;
}

export function normalizeModelRoutes(routes) {
  const src = routes && typeof routes === "object" ? routes : {};
  return {
    openai: normalizeRoute(src.openai, DEFAULT_MODEL_ROUTES.openai),
    anthropic: normalizeRoute(src.anthropic, DEFAULT_MODEL_ROUTES.anthropic),
    gemini: normalizeRoute(src.gemini, DEFAULT_MODEL_ROUTES.gemini),
  };
}

export async function getModelRoutes(userId) {
  if (!userId) {
    return buildDefaultRoutes();
  }

  await dbConnect();
  await ensureModelRoutesReset();
  const settings = await UserSettings.findOne({ userId })
    .select("modelRoutes")
    .lean();
  return normalizeModelRoutes(settings?.modelRoutes);
}

export async function saveModelRoutes(userId, routes) {
  if (!userId) {
    throw new Error("无权限");
  }

  const normalizedRoutes = normalizeModelRoutes(routes);
  await dbConnect();
  await ensureModelRoutesReset();
  const settings = await UserSettings.findOneAndUpdate(
    { userId },
    {
      $set: {
        modelRoutes: normalizedRoutes,
        modelRoutesVersion: MODEL_ROUTES_VERSION,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        userId,
        avatar: null,
        systemPrompts: [],
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  return normalizeModelRoutes(settings?.modelRoutes);
}

export async function resetModelRoutesForUser(userId) {
  const normalizedRoutes = buildDefaultRoutes();
  await dbConnect();
  await ensureModelRoutesReset();
  await UserSettings.findOneAndUpdate(
    { userId },
    {
      $set: {
        modelRoutes: normalizedRoutes,
        modelRoutesVersion: MODEL_ROUTES_VERSION,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        userId,
        avatar: null,
        systemPrompts: [],
      },
    },
    {
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );
  return normalizedRoutes;
}

export function resolveOpenAIProviderConfig(routes) {
  const route = normalizeRoute(routes?.openai, DEFAULT_MODEL_ROUTES.openai);
  if (route === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set");
    }
    return {
      route,
      apiKey,
      baseUrl: OPENROUTER_API_BASE_URL,
      providerLabel: "OpenRouter",
      transport: "openrouter-chat",
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return {
    route,
    apiKey,
    baseUrl: OPENAI_API_BASE_URL,
    providerLabel: "OpenAI 官方",
    transport: "openai-responses",
  };
}

export function resolveAnthropicProviderConfig(routes) {
  const route = normalizeRoute(routes?.anthropic, DEFAULT_MODEL_ROUTES.anthropic);
  if (route === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set");
    }
    return {
      route,
      apiKey,
      baseUrl: OPENROUTER_API_BASE_URL,
      providerLabel: "OpenRouter",
      transport: "openrouter-chat",
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  return {
    route,
    apiKey,
    baseUrl: null,
    providerLabel: "Anthropic 官方",
    transport: "anthropic-messages",
  };
}

export function resolveGeminiProviderConfig(routes) {
  const route = normalizeRoute(routes?.gemini, DEFAULT_MODEL_ROUTES.gemini);
  if (route === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set");
    }
    return {
      route,
      apiKey,
      baseUrl: OPENROUTER_API_BASE_URL,
      providerLabel: "OpenRouter",
      transport: "openrouter-chat",
      useNativeGoogle: false,
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return {
    route,
    apiKey,
    baseUrl: null,
    providerLabel: "Google 官方",
    transport: "google-genai",
    useNativeGoogle: true,
  };
}

export function resolveCouncilProviderRoutes(routes) {
  const normalizedRoutes = normalizeModelRoutes(routes);
  return {
    openai: resolveOpenAIProviderConfig(normalizedRoutes),
    anthropic: resolveAnthropicProviderConfig(normalizedRoutes),
    gemini: resolveGeminiProviderConfig(normalizedRoutes),
  };
}
