import dbConnect from "@/lib/db";
import User from "@/models/User";
import UserSettings from "@/models/UserSettings";
import { isAdminEmail } from "@/lib/admin";

export const DEFAULT_MODEL_ROUTES = Object.freeze({
  openai: "default",
  opus: "default",
  gemini: "default",
});

const OPENAI_ROUTE_VALUES = new Set(["default", "zenmux"]);
const OPUS_ROUTE_VALUES = new Set(["default", "zenmux"]);
const GEMINI_ROUTE_VALUES = new Set(["default", "native"]);

const AICODEMIRROR_API_KEY = process.env.AICODEMIRROR_API_KEY;
const AICODEMIRROR_OPENAI_BASE_URL =
  process.env.AICODEMIRROR_OPENAI_BASE_URL || "https://api.aicodemirror.com/api/codex/backend-api/codex/v1";
const AICODEMIRROR_CLAUDE_BASE_URL =
  process.env.AICODEMIRROR_CLAUDE_BASE_URL || "https://api.aicodemirror.com/api/claudecode";
const AICODEMIRROR_GEMINI_BASE_URL =
  process.env.AICODEMIRROR_GEMINI_BASE_URL || "https://api.aicodemirror.com/api/gemini";
const ZENMUX_OPENAI_BASE_URL = "https://zenmux.ai/api/v1";
const ZENMUX_ANTHROPIC_BASE_URL = "https://zenmux.ai/api/anthropic";
const ZENMUX_API_KEY = process.env.ZENMUX_API_KEY;

function normalizeOpenAIRoute(value) {
  return OPENAI_ROUTE_VALUES.has(value) ? value : DEFAULT_MODEL_ROUTES.openai;
}

function normalizeOpusRoute(value) {
  return OPUS_ROUTE_VALUES.has(value) ? value : DEFAULT_MODEL_ROUTES.opus;
}

function normalizeGeminiRoute(value) {
  if (value === "zenmux") return "native";
  return GEMINI_ROUTE_VALUES.has(value) ? value : DEFAULT_MODEL_ROUTES.gemini;
}

export function normalizeModelRoutes(routes) {
  const src = routes && typeof routes === "object" ? routes : {};
  return {
    openai: normalizeOpenAIRoute(src.openai),
    opus: normalizeOpusRoute(src.opus),
    gemini: normalizeGeminiRoute(src.gemini),
  };
}

async function getRouteAccessUser(userId) {
  if (!userId) return null;
  await dbConnect();
  const user = await User.findById(userId)
    .select("email isAdvancedUser")
    .lean();
  if (!user) return null;
  return {
    userId: user._id,
    email: user.email,
    isAdmin: isAdminEmail(user.email),
    isAdvancedUser: user.isAdvancedUser === true,
  };
}

function canUserSwitchRoutes(user) {
  return Boolean(user && (user.isAdmin || user.isAdvancedUser));
}

function buildDefaultRoutes() {
  return normalizeModelRoutes(DEFAULT_MODEL_ROUTES);
}

export async function getModelRoutes(userId) {
  const accessUser = await getRouteAccessUser(userId);
  if (!canUserSwitchRoutes(accessUser)) {
    return buildDefaultRoutes();
  }
  await dbConnect();
  const settings = await UserSettings.findOne({ userId: accessUser.userId })
    .select("modelRoutes")
    .lean();
  return normalizeModelRoutes(settings?.modelRoutes);
}

export async function saveModelRoutes(userId, routes) {
  const accessUser = await getRouteAccessUser(userId);
  if (!canUserSwitchRoutes(accessUser)) {
    throw new Error("无权限");
  }
  const normalizedRoutes = normalizeModelRoutes(routes);
  await dbConnect();
  const settings = await UserSettings.findOneAndUpdate(
    { userId: accessUser.userId },
    {
      $set: {
        modelRoutes: normalizedRoutes,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        userId: accessUser.userId,
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
  await UserSettings.findOneAndUpdate(
    { userId },
    {
      $set: {
        modelRoutes: normalizedRoutes,
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

  if (!AICODEMIRROR_API_KEY) {
    throw new Error("AICODEMIRROR_API_KEY is not set");
  }
  return {
    route,
    baseUrl: AICODEMIRROR_OPENAI_BASE_URL,
    apiKey: AICODEMIRROR_API_KEY,
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

  if (!AICODEMIRROR_API_KEY) {
    throw new Error("AICODEMIRROR_API_KEY is not set");
  }
  return {
    route,
    baseUrl: AICODEMIRROR_CLAUDE_BASE_URL,
    apiKey: AICODEMIRROR_API_KEY,
  };
}

export function resolveGeminiProviderConfig(routes) {
  const route = normalizeGeminiRoute(routes?.gemini);
  if (route === "native") {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    return {
      route,
      baseUrl: null,
      apiKey: geminiApiKey,
      useNativeGoogle: true,
    };
  }

  if (!AICODEMIRROR_API_KEY) {
    throw new Error("AICODEMIRROR_API_KEY is not set");
  }
  return {
    route,
    baseUrl: AICODEMIRROR_GEMINI_BASE_URL,
    apiKey: AICODEMIRROR_API_KEY,
    useNativeGoogle: false,
  };
}

export function resolveCouncilProviderRoutes(routes) {
  const normalizedRoutes = normalizeModelRoutes(routes);
  return {
    openai: resolveOpenAIProviderConfig(normalizedRoutes),
    opus: resolveOpusProviderConfig(normalizedRoutes),
    gemini: resolveGeminiProviderConfig(normalizedRoutes),
  };
}
