"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  UI_ACTIVE_PROMPT_IDS_KEY,
  UI_BUDGET_TOKENS_KEY,
  UI_COMPLETION_SOUND_VOLUME_KEY,
  UI_FONT_SIZE_KEY,
  UI_HISTORY_LIMIT_KEY,
  UI_MAX_TOKENS_KEY,
  UI_MODEL_KEY,
  UI_ROUTE_MODE_KEY,
  UI_THEME_MODE_KEY,
  UI_THINKING_LEVELS_KEY,
  UI_WEB_SEARCH_KEY,
} from "./storageKeys";
import { LINE_MODES } from "./economyModels";

const SEED_MODEL_ID = "volcengine/doubao-seed-2.0-pro";
const DEFAULT_MODEL = SEED_MODEL_ID;
const MAX_TOKENS_64K = 64000;
const MAX_TOKENS_128K = 128000;
const DEFAULT_THINKING_LEVELS = {
  "gemini-3-flash-preview": "high",
  "gemini-3-pro-preview": "high",
  "claude-sonnet-4-6-20260219": "high",
  "claude-opus-4-6-20260205": "high",
  "gpt-5.2": "medium",
  [SEED_MODEL_ID]: "medium",
};
const DEFAULT_MAX_TOKENS = MAX_TOKENS_64K;
const DEFAULT_BUDGET_TOKENS = 32000;
const DEFAULT_COMPLETION_SOUND_VOLUME = 60;
const DEFAULT_ROUTE_MODE = LINE_MODES.PREMIUM;

// localStorage keys - 所有设置都本地存储，只有 systemPrompts 内容存数据库

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readLocalSetting(key) {
  try {
    if (typeof window === "undefined") return null;
    const v = window.localStorage?.getItem?.(key);
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

function readLocalJson(key) {
  try {
    const v = readLocalSetting(key);
    return v ? JSON.parse(v) : null;
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

export function useUserSettings() {
  const [model, _setModel] = useState(DEFAULT_MODEL);
  const [thinkingLevels, _setThinkingLevels] = useState(DEFAULT_THINKING_LEVELS);
  const [historyLimit, _setHistoryLimit] = useState(0);
  const [systemPrompts, setSystemPrompts] = useState([]);
  const [activePromptIds, _setActivePromptIds] = useState({});
  const [activePromptId, _setActivePromptId] = useState(null);
  const [themeMode, _setThemeMode] = useState("system");
  const [fontSize, _setFontSize] = useState("medium");
  const [maxTokens, _setMaxTokens] = useState(DEFAULT_MAX_TOKENS);
  const [budgetTokens, _setBudgetTokens] = useState(DEFAULT_BUDGET_TOKENS);
  const [webSearch, _setWebSearch] = useState(true);
  const [avatar, _setAvatar] = useState(null);
  const [completionSoundVolume, _setCompletionSoundVolume] = useState(DEFAULT_COMPLETION_SOUND_VOLUME);
  const [routeMode, _setRouteMode] = useState(DEFAULT_ROUTE_MODE);
  const [settingsError, setSettingsError] = useState(null);

  const modelRef = useRef(model);
  modelRef.current = model;

  // 从 localStorage 读取所有本地设置
  useEffect(() => {
    const localTheme = readLocalSetting(UI_THEME_MODE_KEY);
    const localFont = readLocalSetting(UI_FONT_SIZE_KEY);
    const localModel = readLocalSetting(UI_MODEL_KEY);
    const localThinkingLevels = readLocalJson(UI_THINKING_LEVELS_KEY);
    const localHistoryLimit = readLocalSetting(UI_HISTORY_LIMIT_KEY);
    const localActivePromptIds = readLocalJson(UI_ACTIVE_PROMPT_IDS_KEY);
    const localMaxTokens = readLocalSetting(UI_MAX_TOKENS_KEY);
    const localBudgetTokens = readLocalSetting(UI_BUDGET_TOKENS_KEY);
    const localWebSearch = readLocalSetting(UI_WEB_SEARCH_KEY);
    const localCompletionSoundVolume = readLocalSetting(UI_COMPLETION_SOUND_VOLUME_KEY);
    const localRouteMode = readLocalSetting(UI_ROUTE_MODE_KEY);

    const initialModel = typeof localModel === "string" && localModel
      ? localModel
      : DEFAULT_MODEL;

    if (typeof localTheme === "string") _setThemeMode(localTheme);
    if (typeof localFont === "string") _setFontSize(localFont);
    if (typeof localModel === "string") _setModel(localModel);
    if (isPlainObject(localThinkingLevels)) _setThinkingLevels(localThinkingLevels);
    if (localHistoryLimit !== null) {
      const parsed = Number(localHistoryLimit);
      _setHistoryLimit(Number.isFinite(parsed) ? parsed : 0);
    }
    if (isPlainObject(localActivePromptIds)) {
      _setActivePromptIds(localActivePromptIds);
      const remembered = localActivePromptIds?.[initialModel];
      if (typeof remembered === "string" && remembered) {
        _setActivePromptId(remembered);
      }
    }
    if (localMaxTokens !== null) {
      const parsed = Number(localMaxTokens);
      _setMaxTokens(Number.isFinite(parsed) ? parsed : DEFAULT_MAX_TOKENS);
    }
    if (localBudgetTokens !== null) {
      const parsed = Number(localBudgetTokens);
      _setBudgetTokens(Number.isFinite(parsed) ? parsed : DEFAULT_BUDGET_TOKENS);
    }
    if (localWebSearch === "true") _setWebSearch(true);
    else if (localWebSearch === "false") _setWebSearch(false);
    if (localCompletionSoundVolume !== null) {
      const parsed = Number(localCompletionSoundVolume);
      _setCompletionSoundVolume(Number.isFinite(parsed) ? parsed : DEFAULT_COMPLETION_SOUND_VOLUME);
    }
    if (localRouteMode === LINE_MODES.ECONOMY || localRouteMode === LINE_MODES.PREMIUM) {
      _setRouteMode(localRouteMode);
    }
  }, []);

  const setModel = useCallback((m) => {
    _setModel(m);
    writeLocalSetting(UI_MODEL_KEY, m);
  }, []);

  useEffect(() => {
    if (typeof model !== "string") return;
    if (model === SEED_MODEL_ID || model.startsWith("gemini-")) {
      if (maxTokens > MAX_TOKENS_64K) {
        _setMaxTokens(MAX_TOKENS_64K);
        writeLocalSetting(UI_MAX_TOKENS_KEY, String(MAX_TOKENS_64K));
      }
      return;
    }
    if (model.startsWith("claude-opus-4-6") || model.startsWith("claude-sonnet-4-6")) {
      if (maxTokens > MAX_TOKENS_128K) {
        _setMaxTokens(MAX_TOKENS_128K);
        writeLocalSetting(UI_MAX_TOKENS_KEY, String(MAX_TOKENS_128K));
      }
      return;
    }
    if (model.startsWith("claude-")) {
      if (maxTokens > MAX_TOKENS_64K) {
        _setMaxTokens(MAX_TOKENS_64K);
        writeLocalSetting(UI_MAX_TOKENS_KEY, String(MAX_TOKENS_64K));
      }
      return;
    }
    if (model.startsWith("gpt-") && maxTokens !== MAX_TOKENS_128K) {
      _setMaxTokens(MAX_TOKENS_128K);
      writeLocalSetting(UI_MAX_TOKENS_KEY, String(MAX_TOKENS_128K));
    }
  }, [model, maxTokens]);

  const setThemeMode = useCallback((mode) => {
    _setThemeMode(mode);
    writeLocalSetting(UI_THEME_MODE_KEY, mode);
  }, []);

  const setFontSize = useCallback((size) => {
    _setFontSize(size);
    writeLocalSetting(UI_FONT_SIZE_KEY, size);
  }, []);

  const setThinkingLevels = useCallback((levels) => {
    _setThinkingLevels(levels);
    writeLocalJson(UI_THINKING_LEVELS_KEY, levels);
  }, []);

  const setHistoryLimit = useCallback((limit) => {
    _setHistoryLimit(limit);
    writeLocalSetting(UI_HISTORY_LIMIT_KEY, String(limit));
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

  const setMaxTokens = useCallback((tokens) => {
    _setMaxTokens(tokens);
    writeLocalSetting(UI_MAX_TOKENS_KEY, String(tokens));
  }, []);

  const setBudgetTokens = useCallback((tokens) => {
    _setBudgetTokens(tokens);
    writeLocalSetting(UI_BUDGET_TOKENS_KEY, String(tokens));
  }, []);

  const setWebSearch = useCallback((enabled) => {
    _setWebSearch(enabled);
    writeLocalSetting(UI_WEB_SEARCH_KEY, String(enabled));
  }, []);

  const setCompletionSoundVolume = useCallback((volume) => {
    _setCompletionSoundVolume(volume);
    writeLocalSetting(UI_COMPLETION_SOUND_VOLUME_KEY, String(volume));
  }, []);

  const setRouteMode = useCallback((mode) => {
    const normalized = mode === LINE_MODES.ECONOMY ? LINE_MODES.ECONOMY : LINE_MODES.PREMIUM;
    _setRouteMode(normalized);
    writeLocalSetting(UI_ROUTE_MODE_KEY, normalized);
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
      // 只从服务器读取 systemPrompts 和 avatar，其他都从 localStorage
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
    setThinkingLevels,
    historyLimit,
    setHistoryLimit,
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
    setMaxTokens,
    budgetTokens,
    setBudgetTokens,
    webSearch,
    setWebSearch,
    completionSoundVolume,
    setCompletionSoundVolume,
    routeMode,
    setRouteMode,
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
