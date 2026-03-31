import dbConnect from "@/lib/db";
import User from "@/models/User";
import UserSettings from "@/models/UserSettings";
import { isAdminEmail } from "@/lib/admin";
import {
  resolveAnthropicProviderConfig as resolveDefaultAnthropicProviderConfig,
  resolveGeminiProviderConfig as resolveDefaultGeminiProviderConfig,
  resolveOpenAIProviderConfig as resolveDefaultOpenAIProviderConfig,
} from "@/lib/providerConfigs";

export const DEFAULT_MODEL_ROUTES = Object.freeze({
  openai: "default",
  opus: "default",
  gemini: "default",
});

const OPENAI_ROUTE_VALUES = new Set(["default"]);
const OPUS_ROUTE_VALUES = new Set(["default"]);
const GEMINI_ROUTE_VALUES = new Set(["default"]);

function normalizeOpenAIRoute(value) {
  return OPENAI_ROUTE_VALUES.has(value) ? value : DEFAULT_MODEL_ROUTES.openai;
}

function normalizeOpusRoute(value) {
  return OPUS_ROUTE_VALUES.has(value) ? value : DEFAULT_MODEL_ROUTES.opus;
}

function normalizeGeminiRoute(value) {
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
  return {
    route: "default",
    ...resolveDefaultOpenAIProviderConfig(),
  };
}

export function resolveOpusProviderConfig(routes) {
  return {
    route: "default",
    ...resolveDefaultAnthropicProviderConfig(),
  };
}

export function resolveGeminiProviderConfig(routes) {
  return {
    route: "default",
    ...resolveDefaultGeminiProviderConfig(),
    useNativeGoogle: true,
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
