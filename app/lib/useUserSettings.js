"use client";

import { useCallback, useEffect, useState } from "react";
import {
  UI_ACTIVE_PROMPT_IDS_KEY,
  UI_COMPLETION_SOUND_VOLUME_KEY,
  UI_FONT_SIZE_KEY,
  UI_MODEL_KEY,
  UI_THEME_MODE_KEY,
  UI_WEB_SEARCH_KEY,
} from "./storageKeys";
import { OPENAI_PRIMARY_MODEL } from "./openaiModel";
import {
  LEGACY_PREFIXED_SEED_MODEL_ID,
  LEGACY_SEED_MODEL_ID,
  SEED_MODEL_ID,
  normalizeSeedModelId,
} from "./seedModel";

const DEFAULT_MODEL = "deepseek-chat";
const MAX_TOKENS_64K = 64000;
const MAX_TOKENS_128K = 128000;
const DEFAULT_THINKING_LEVELS = {
  "gemini-3-flash-preview": "HIGH",
  "gemini-3.1-pro-preview": "HIGH",
  "claude-sonnet-4-6-20260219": "max",
  "claude-opus-4-6-20260205": "max",
  [OPENAI_PRIMARY_MODEL]: "xhigh",
  [SEED_MODEL_ID]: "high",
  "deepseek-reasoner": "medium",
};
const DEFAULT_BUDGET_TOKENS = 32000;
const DEFAULT_COMPLETION_SOUND_VOLUME = 60;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readLocalSetting(key) {
  try {
    if (typeof window === "undefined") return null;
    const value = window.localStorage?.getItem?.(key);
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

function readLocalJson(key) {
  try {
    const value = readLocalSetting(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeLocalSetting(key, value) {
  try {
    if (typeof window === "undefined") return;
    if (value == null) window.localStorage?.removeItem?.(key);
    else window.localStorage?.setItem?.(key, String(value));
  } catch {
    // ignore
  }
}

function writeLocalJson(key, value) {
  try {
    if (typeof window === "undefined") return;
    if (value == null) window.localStorage?.removeItem?.(key);
    else window.localStorage?.setItem?.(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function normalizeModelKeyedObject(value) {
  if (!isPlainObject(value)) return value;
  const next = { ...value };
  const legacyKeys = [LEGACY_SEED_MODEL_ID, LEGACY_PREFIXED_SEED_MODEL_ID];
  for (const legacyKey of legacyKeys) {
    if (next[legacyKey] !== undefined && next[SEED_MODEL_ID] === undefined) {
      next[SEED_MODEL_ID] = next[legacyKey];
    }
    delete next[legacyKey];
  }
  return next;
}

function getDefaultMaxTokensForModel(model) {
  if (typeof model !== "string" || !model) return MAX_TOKENS_64K;
  if (model.startsWith("gpt-") || model.startsWith("claude-opus-4-6")) {
    return MAX_TOKENS_128K;
  }
  return MAX_TOKENS_64K;
}

export function useUserSettings() {
  const [model, _setModel] = useState(DEFAULT_MODEL);
  const [systemPrompts, setSystemPrompts] = useState([]);
  const [activePromptIds, _setActivePromptIds] = useState({});
  const [activePromptId, _setActivePromptId] = useState(null);
  const [themeMode, _setThemeMode] = useState("system");
  const [fontSize, _setFontSize] = useState("medium");
  const [webSearch, _setWebSearch] = useState(true);
  const [avatar, _setAvatar] = useState(null);
  const [completionSoundVolume, _setCompletionSoundVolume] = useState(DEFAULT_COMPLETION_SOUND_VOLUME);
  const [settingsError, setSettingsError] = useState(null);

  const thinkingLevels = DEFAULT_THINKING_LEVELS;
  const historyLimit = 0;
  const maxTokens = getDefaultMaxTokensForModel(model);
  const budgetTokens = DEFAULT_BUDGET_TOKENS;

  useEffect(() => {
    const localTheme = readLocalSetting(UI_THEME_MODE_KEY);
    const localFont = readLocalSetting(UI_FONT_SIZE_KEY);
    const localModel = readLocalSetting(UI_MODEL_KEY);
    const localActivePromptIds = readLocalJson(UI_ACTIVE_PROMPT_IDS_KEY);
    const localWebSearch = readLocalSetting(UI_WEB_SEARCH_KEY);
    const localCompletionSoundVolume = readLocalSetting(UI_COMPLETION_SOUND_VOLUME_KEY);

    const normalizedModel = typeof localModel === "string" && localModel
      ? normalizeSeedModelId(localModel)
      : null;
    const initialModel = typeof normalizedModel === "string" && normalizedModel
      ? normalizedModel
      : DEFAULT_MODEL;

    if (typeof localTheme === "string") _setThemeMode(localTheme);
    if (typeof localFont === "string") _setFontSize(localFont);
    if (typeof initialModel === "string") {
      _setModel(initialModel);
      writeLocalSetting(UI_MODEL_KEY, initialModel);
    }
    if (isPlainObject(localActivePromptIds)) {
      const normalizedActivePromptIds = normalizeModelKeyedObject(localActivePromptIds);
      _setActivePromptIds(normalizedActivePromptIds);
      writeLocalJson(UI_ACTIVE_PROMPT_IDS_KEY, normalizedActivePromptIds);
      const remembered = normalizedActivePromptIds?.[initialModel];
      if (typeof remembered === "string" && remembered) {
        _setActivePromptId(remembered);
      }
    }
    if (localWebSearch === "true") _setWebSearch(true);
    else if (localWebSearch === "false") _setWebSearch(false);
    if (localCompletionSoundVolume !== null) {
      const parsed = Number(localCompletionSoundVolume);
      _setCompletionSoundVolume(Number.isFinite(parsed) ? parsed : DEFAULT_COMPLETION_SOUND_VOLUME);
    }
  }, []);

  const setModel = useCallback((nextModel) => {
    const normalized = normalizeSeedModelId(nextModel);
    _setModel(normalized);
    writeLocalSetting(UI_MODEL_KEY, normalized);
  }, []);

  const setThemeMode = useCallback((mode) => {
    _setThemeMode(mode);
    writeLocalSetting(UI_THEME_MODE_KEY, mode);
  }, []);

  const setFontSize = useCallback((size) => {
    _setFontSize(size);
    writeLocalSetting(UI_FONT_SIZE_KEY, size);
  }, []);

  const setActivePromptIds = useCallback((ids) => {
    _setActivePromptIds((prev) => {
      const next = typeof ids === "function" ? ids(prev) : ids;
      const normalized = isPlainObject(next) ? next : {};
      writeLocalJson(UI_ACTIVE_PROMPT_IDS_KEY, normalized);
      return normalized;
    });
  }, []);

  const setActivePromptId = useCallback((id) => {
    _setActivePromptId(typeof id === "string" && id ? id : null);
  }, []);

  const setWebSearch = useCallback((enabled) => {
    _setWebSearch(enabled);
    writeLocalSetting(UI_WEB_SEARCH_KEY, String(enabled));
  }, []);

  const setCompletionSoundVolume = useCallback((volume) => {
    _setCompletionSoundVolume(volume);
    writeLocalSetting(UI_COMPLETION_SOUND_VOLUME_KEY, String(volume));
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        setSettingsError(data?.error);
        return null;
      }

      const settings = data?.settings;
      if (!settings || typeof settings !== "object") {
        setSettingsError("Invalid settings response");
        return null;
      }

      setSettingsError(null);
      if (Array.isArray(settings.systemPrompts)) {
        setSystemPrompts(settings.systemPrompts);
      }
      if (settings.avatar !== undefined) {
        _setAvatar(settings.avatar);
      }

      return settings;
    } catch (e) {
      setSettingsError(e?.message);
      return null;
    }
  }, []);

  const addPrompt = useCallback(async ({ name, content }) => {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        setSettingsError(data?.error);
        return null;
      }

      setSettingsError(null);
      const settings = data?.settings;
      if (settings && Array.isArray(settings.systemPrompts)) {
        setSystemPrompts(settings.systemPrompts);
      }
      return settings;
    } catch (e) {
      setSettingsError(e?.message);
      return null;
    }
  }, []);

  const deletePrompt = useCallback(async (promptId) => {
    try {
      const res = await fetch("/api/settings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        setSettingsError(data?.error);
        return null;
      }

      setSettingsError(null);
      const settings = data?.settings;
      if (settings && Array.isArray(settings.systemPrompts)) {
        setSystemPrompts(settings.systemPrompts);
      }
      return settings;
    } catch (e) {
      setSettingsError(e?.message);
      return null;
    }
  }, []);

  const updatePrompt = useCallback(async ({ promptId, name, content }) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId, name, content }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        setSettingsError(data?.error);
        return null;
      }

      setSettingsError(null);
      const settings = data?.settings;
      if (settings && Array.isArray(settings.systemPrompts)) {
        setSystemPrompts(settings.systemPrompts);
      }
      return settings;
    } catch (e) {
      setSettingsError(e?.message);
      return null;
    }
  }, []);

  const setAvatar = useCallback(async (avatarUrl) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: avatarUrl }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        setSettingsError(data?.error);
        return null;
      }

      setSettingsError(null);
      const settings = data?.settings;
      if (settings?.avatar !== undefined) {
        _setAvatar(settings.avatar);
      }
      return settings;
    } catch (e) {
      setSettingsError(e?.message);
      return null;
    }
  }, []);

  return {
    model,
    setModel,
    thinkingLevels,
    historyLimit,
    systemPrompts,
    setSystemPrompts,
    activePromptIds,
    setActivePromptIds,
    activePromptId,
    setActivePromptId,
    themeMode,
    setThemeMode,
    fontSize,
    setFontSize,
    maxTokens,
    budgetTokens,
    webSearch,
    setWebSearch,
    completionSoundVolume,
    setCompletionSoundVolume,
    settingsError,
    setSettingsError,
    fetchSettings,
    addPrompt,
    deletePrompt,
    updatePrompt,
    avatar,
    setAvatar,
  };
}
