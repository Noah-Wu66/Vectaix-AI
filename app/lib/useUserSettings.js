"use client";

import { useCallback, useState } from "react";

const DEFAULT_MODEL = "gemini-3-pro-preview";
const DEFAULT_THINKING_LEVELS = {
  "gemini-3-flash-preview": "high",
  "gemini-3-pro-preview": "high",
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function useUserSettings() {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [thinkingLevels, setThinkingLevels] = useState(DEFAULT_THINKING_LEVELS);
  const [historyLimit, setHistoryLimit] = useState(0);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [systemPrompts, setSystemPrompts] = useState([]);
  const [activePromptId, setActivePromptId] = useState(null);
  const [themeMode, setThemeMode] = useState("system");
  const [fontSize, setFontSize] = useState("medium");
  const [settingsError, setSettingsError] = useState(null);

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
      if (typeof settings.model === "string") setModel(settings.model);
      setThinkingLevels(settings.thinkingLevels);
      if (typeof settings.historyLimit === "number") setHistoryLimit(settings.historyLimit);
      if (typeof settings.aspectRatio === "string") setAspectRatio(settings.aspectRatio);
      if (Array.isArray(settings.systemPrompts)) setSystemPrompts(settings.systemPrompts);
      setActivePromptId(settings.activeSystemPromptId || null);
      if (typeof settings.themeMode === "string") setThemeMode(settings.themeMode);
      if (typeof settings.fontSize === "string") setFontSize(settings.fontSize);

      return settings;
    } catch (e) {
      setSettingsError(e?.message || "Settings error");
      return null;
    }
  }, []);

  const saveSettings = useCallback(async (updates) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates || {}),
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
        setActivePromptId(settings.activeSystemPromptId || null);
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
      if (settings && typeof settings === "object") {
        if (Array.isArray(settings.systemPrompts)) setSystemPrompts(settings.systemPrompts);
        setActivePromptId(settings.activeSystemPromptId || null);
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
    aspectRatio,
    setAspectRatio,
    systemPrompts,
    setSystemPrompts,
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
  };
}


