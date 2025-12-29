"use client";

import { useCallback, useEffect, useState } from "react";

const DEFAULT_MODEL = "gemini-3-pro-preview";
const DEFAULT_THINKING_LEVELS = {
  "gemini-3-flash-preview": "high",
  "gemini-3-pro-preview": "high",
};

const UI_THEME_MODE_KEY = "vectaix_ui_themeMode";
const UI_FONT_SIZE_KEY = "vectaix_ui_fontSize";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readLocalUiSetting(key) {
  try {
    if (typeof window === "undefined") return null;
    const v = window.localStorage?.getItem?.(key);
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

function writeLocalUiSetting(key, value) {
  try {
    if (typeof window === "undefined") return;
    if (value == null) window.localStorage?.removeItem?.(key);
    else window.localStorage?.setItem?.(key, String(value));
  } catch {
    // ignore
  }
}

export function useUserSettings() {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [thinkingLevels, setThinkingLevels] = useState(DEFAULT_THINKING_LEVELS);
  const [historyLimit, setHistoryLimit] = useState(0);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [imageSize, setImageSize] = useState("2K");
  const [systemPrompts, setSystemPrompts] = useState([]);
  const [activePromptIds, setActivePromptIds] = useState({});
  const [activePromptId, setActivePromptId] = useState(null);
  const [themeMode, _setThemeMode] = useState("system");
  const [fontSize, _setFontSize] = useState("medium");
  const [settingsError, setSettingsError] = useState(null);

  // 主题/字号只保存在本地（localStorage），不走数据库
  useEffect(() => {
    const localTheme = readLocalUiSetting(UI_THEME_MODE_KEY);
    const localFont = readLocalUiSetting(UI_FONT_SIZE_KEY);
    if (typeof localTheme === "string") _setThemeMode(localTheme);
    if (typeof localFont === "string") _setFontSize(localFont);
  }, []);

  const setThemeMode = useCallback((mode) => {
    _setThemeMode(mode);
    writeLocalUiSetting(UI_THEME_MODE_KEY, mode);
  }, []);

  const setFontSize = useCallback((size) => {
    _setFontSize(size);
    writeLocalUiSetting(UI_FONT_SIZE_KEY, size);
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
      if (!settings || typeof settings !== "object" || !isPlainObject(settings.thinkingLevels)) {
        setSettingsError("Outdated settings: missing thinkingLevels");
        return null;
      }

      setSettingsError(null);
      const nextModel = typeof settings.model === "string" ? settings.model : model;
      if (typeof settings.model === "string") setModel(settings.model);
      setThinkingLevels(settings.thinkingLevels);
      if (typeof settings.historyLimit === "number") setHistoryLimit(settings.historyLimit);
      if (typeof settings.aspectRatio === "string") setAspectRatio(settings.aspectRatio);
      if (typeof settings.imageSize === "string") setImageSize(settings.imageSize);
      if (Array.isArray(settings.systemPrompts)) setSystemPrompts(settings.systemPrompts);
      const ids = isPlainObject(settings.activeSystemPromptIds)
        ? settings.activeSystemPromptIds
        : (settings.activeSystemPromptId ? { [nextModel]: settings.activeSystemPromptId } : {});
      setActivePromptIds(ids);
      setActivePromptId(ids?.[nextModel] || settings.activeSystemPromptId || null);

      return settings;
    } catch (e) {
      setSettingsError(e?.message || "Settings error");
      return null;
    }
  }, [model]);

  const saveSettings = useCallback(async (updates) => {
    try {
      // UI 设置不入库：themeMode/fontSize 直接丢弃
      const nextUpdates = { ...(updates || {}) };
      delete nextUpdates.themeMode;
      delete nextUpdates.fontSize;

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextUpdates),
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
      return data?.settings ?? null;
    } catch (e) {
      setSettingsError(e?.message || "Settings error");
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
        setSettingsError(data?.error || res.statusText || "Settings error");
        return null;
      }

      setSettingsError(null);
      const settings = data?.settings;
      if (settings && typeof settings === "object") {
        if (Array.isArray(settings.systemPrompts)) setSystemPrompts(settings.systemPrompts);
        const ids = isPlainObject(settings.activeSystemPromptIds) ? settings.activeSystemPromptIds : (activePromptIds || {});
        setActivePromptIds(ids);
        setActivePromptId(ids?.[model] || settings.activeSystemPromptId || null);
      }
      return settings ?? null;
    } catch (e) {
      setSettingsError(e?.message || "Settings error");
      return null;
    }
  }, [activePromptIds, model]);

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
      if (settings && typeof settings === "object") {
        if (Array.isArray(settings.systemPrompts)) setSystemPrompts(settings.systemPrompts);
        const ids = isPlainObject(settings.activeSystemPromptIds) ? settings.activeSystemPromptIds : (activePromptIds || {});
        setActivePromptIds(ids);
        setActivePromptId(ids?.[model] || settings.activeSystemPromptId || null);
      }
      return settings ?? null;
    } catch (e) {
      setSettingsError(e?.message || "Settings error");
      return null;
    }
  }, [activePromptIds, model]);

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
      if (settings && typeof settings === "object") {
        if (Array.isArray(settings.systemPrompts)) setSystemPrompts(settings.systemPrompts);
        const ids = isPlainObject(settings.activeSystemPromptIds) ? settings.activeSystemPromptIds : (activePromptIds || {});
        setActivePromptIds(ids);
        setActivePromptId(ids?.[model] || settings.activeSystemPromptId || null);
      }
      return settings ?? null;
    } catch (e) {
      setSettingsError(e?.message || "Settings error");
      return null;
    }
  }, [activePromptIds, model]);

  return {
    model,
    setModel,
    thinkingLevels,
    setThinkingLevels,
    historyLimit,
    setHistoryLimit,
    aspectRatio,
    setAspectRatio,
    imageSize,
    setImageSize,
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


