"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_MODEL = "gemini-3-pro-preview";
const DEFAULT_THINKING_LEVELS = {
  "gemini-3-flash-preview": "high",
  "gemini-3-pro-preview": "high",
};

// localStorage keys - 所有设置都本地存储，只有 systemPrompts 内容存数据库
const UI_THEME_MODE_KEY = "vectaix_ui_themeMode";
const UI_FONT_SIZE_KEY = "vectaix_ui_fontSize";
const UI_MODEL_KEY = "vectaix_ui_model";
const UI_THINKING_LEVELS_KEY = "vectaix_ui_thinkingLevels";
const UI_HISTORY_LIMIT_KEY = "vectaix_ui_historyLimit";
const UI_ACTIVE_PROMPT_IDS_KEY = "vectaix_ui_activePromptIds";
const UI_ACTIVE_PROMPT_ID_KEY = "vectaix_ui_activePromptId";

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
    const localActivePromptId = readLocalSetting(UI_ACTIVE_PROMPT_ID_KEY);

    if (typeof localTheme === "string") _setThemeMode(localTheme);
    if (typeof localFont === "string") _setFontSize(localFont);
    if (typeof localModel === "string") _setModel(localModel);
    if (isPlainObject(localThinkingLevels)) _setThinkingLevels(localThinkingLevels);
    if (localHistoryLimit !== null) _setHistoryLimit(Number(localHistoryLimit) || 0);
    if (isPlainObject(localActivePromptIds)) _setActivePromptIds(localActivePromptIds);
    if (typeof localActivePromptId === "string") _setActivePromptId(localActivePromptId);
  }, []);

  const setModel = useCallback((m) => {
    _setModel(m);
    writeLocalSetting(UI_MODEL_KEY, m);
  }, []);

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
    _setActivePromptIds(ids);
    writeLocalJson(UI_ACTIVE_PROMPT_IDS_KEY, ids);
  }, []);

  const setActivePromptId = useCallback((id) => {
    _setActivePromptId(id);
    writeLocalSetting(UI_ACTIVE_PROMPT_ID_KEY, id);
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
        setSettingsError(data?.error || res.statusText || "Settings error");
        return null;
      }

      const settings = data?.settings;
      if (!settings || typeof settings !== "object") {
        setSettingsError("Invalid settings response");
        return null;
      }

      setSettingsError(null);
      // 只从服务器读取 systemPrompts，其他都从 localStorage
      if (Array.isArray(settings.systemPrompts)) {
        setSystemPrompts(settings.systemPrompts);
      }

      return settings;
    } catch (e) {
      setSettingsError(e?.message || "Settings error");
      return null;
    }
  }, []);

  // saveSettings 现在不发送任何设置到服务器（因为都本地存储了）
  // 保留这个函数以便向后兼容，但实际上不做任何事
  const saveSettings = useCallback(async () => {
    return null;
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
        setSettingsError(data?.error || res.statusText || "Settings error");
        return null;
      }

      setSettingsError(null);
      const settings = data?.settings;
      if (settings && Array.isArray(settings.systemPrompts)) {
        setSystemPrompts(settings.systemPrompts);
      }
      return settings ?? null;
    } catch (e) {
      setSettingsError(e?.message || "Settings error");
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
        setSettingsError(data?.error || res.statusText || "Settings error");
        return null;
      }

      setSettingsError(null);
      const settings = data?.settings;
      if (settings && Array.isArray(settings.systemPrompts)) {
        setSystemPrompts(settings.systemPrompts);
      }
      return settings ?? null;
    } catch (e) {
      setSettingsError(e?.message || "Settings error");
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
        setSettingsError(data?.error || res.statusText || "Settings error");
        return null;
      }

      setSettingsError(null);
      const settings = data?.settings;
      if (settings && Array.isArray(settings.systemPrompts)) {
        setSystemPrompts(settings.systemPrompts);
      }
      return settings ?? null;
    } catch (e) {
      setSettingsError(e?.message || "Settings error");
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
    settingsError,
    setSettingsError,
    fetchSettings,
    saveSettings,
    addPrompt,
    deletePrompt,
    updatePrompt,
  };
}
