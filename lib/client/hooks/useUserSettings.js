"use client";

import { useCallback, useEffect, useState } from "react";
import {
  UI_ACTIVE_PROMPT_IDS_KEY,
  UI_AGENT_MODEL_KEY,
  UI_COMPLETION_SOUND_VOLUME_KEY,
  UI_FONT_SIZE_KEY,
  UI_MODEL_KEY,
  UI_THEME_MODE_KEY,
  UI_WEB_SEARCH_KEY,
} from "@/lib/shared/storageKeys";
import {
  DEFAULT_AGENT_DRIVER_MODEL,
  DEFAULT_MODEL,
  DEFAULT_THINKING_LEVELS,
  LEGACY_PREFIXED_SEED_MODEL_ID,
  LEGACY_SEED_MODEL_ID,
  SEED_MODEL_ID,
  getDefaultMaxTokensForModel,
  normalizeAgentDriverModelId,
  normalizeSeedModelId,
} from "@/lib/shared/models";
import { apiJson } from "@/lib/client/apiClient";
import {
  readLocalJson,
  readLocalSetting,
  writeLocalJson,
  writeLocalSetting,
} from "@/lib/client/localSettings";
import { DEFAULT_WEB_SEARCH_SETTINGS, normalizeWebSearchSettings } from "@/lib/shared/webSearch";

const DEFAULT_COMPLETION_SOUND_VOLUME = 60;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function normalizeStoredModelId(model) {
  return normalizeSeedModelId(model);
}

export function useUserSettings() {
  const [model, _setModel] = useState(DEFAULT_MODEL);
  const [agentModel, _setAgentModel] = useState(DEFAULT_AGENT_DRIVER_MODEL);
  const [isSettingsReady, setIsSettingsReady] = useState(false);
  const [systemPrompts, setSystemPrompts] = useState([]);
  const [activePromptIds, _setActivePromptIds] = useState({});
  const [activePromptId, _setActivePromptId] = useState(null);
  const [themeMode, _setThemeMode] = useState("system");
  const [fontSize, _setFontSize] = useState("medium");
  const [webSearch, _setWebSearch] = useState(DEFAULT_WEB_SEARCH_SETTINGS);
  const [avatar, _setAvatar] = useState(null);
  const [completionSoundVolume, _setCompletionSoundVolume] = useState(DEFAULT_COMPLETION_SOUND_VOLUME);
  const [settingsError, setSettingsError] = useState(null);

  const thinkingLevels = DEFAULT_THINKING_LEVELS;
  const historyLimit = 0;
  const maxTokens = getDefaultMaxTokensForModel(model);

  useEffect(() => {
    const localTheme = readLocalSetting(UI_THEME_MODE_KEY);
    const localFont = readLocalSetting(UI_FONT_SIZE_KEY);
    const localModel = readLocalSetting(UI_MODEL_KEY);
    const localAgentModel = readLocalSetting(UI_AGENT_MODEL_KEY);
    const localActivePromptIds = readLocalJson(UI_ACTIVE_PROMPT_IDS_KEY);
    const localWebSearch = readLocalJson(UI_WEB_SEARCH_KEY);
    const localCompletionSoundVolume = readLocalSetting(UI_COMPLETION_SOUND_VOLUME_KEY);

    const normalizedModel = typeof localModel === "string" && localModel
      ? normalizeStoredModelId(localModel)
      : null;
    const initialModel = typeof normalizedModel === "string" && normalizedModel
      ? normalizedModel
      : DEFAULT_MODEL;
    const initialAgentModel = typeof localAgentModel === "string" && localAgentModel
      ? normalizeAgentDriverModelId(localAgentModel)
      : DEFAULT_AGENT_DRIVER_MODEL;

    if (typeof localTheme === "string") _setThemeMode(localTheme);
    if (typeof localFont === "string") _setFontSize(localFont);
    if (typeof initialModel === "string") {
      _setModel(initialModel);
      writeLocalSetting(UI_MODEL_KEY, initialModel);
    }
    _setAgentModel(initialAgentModel);
    writeLocalSetting(UI_AGENT_MODEL_KEY, initialAgentModel);
    if (isPlainObject(localActivePromptIds)) {
      const normalizedActivePromptIds = normalizeModelKeyedObject(localActivePromptIds);
      _setActivePromptIds(normalizedActivePromptIds);
      writeLocalJson(UI_ACTIVE_PROMPT_IDS_KEY, normalizedActivePromptIds);
      const remembered = normalizedActivePromptIds?.[initialModel];
      if (typeof remembered === "string" && remembered) {
        _setActivePromptId(remembered);
      }
    }
    _setWebSearch(normalizeWebSearchSettings(localWebSearch, { defaultEnabled: true }));
    if (localCompletionSoundVolume !== null) {
      const parsed = Number(localCompletionSoundVolume);
      _setCompletionSoundVolume(Number.isFinite(parsed) ? parsed : DEFAULT_COMPLETION_SOUND_VOLUME);
    }
    setIsSettingsReady(true);
  }, []);

  const setModel = useCallback((nextModel) => {
    const normalized = normalizeStoredModelId(nextModel);
    _setModel(normalized);
    writeLocalSetting(UI_MODEL_KEY, normalized);
  }, []);

  const setAgentModel = useCallback((nextModel) => {
    const normalized = normalizeAgentDriverModelId(nextModel);
    _setAgentModel(normalized);
    writeLocalSetting(UI_AGENT_MODEL_KEY, normalized);
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

  const setWebSearch = useCallback((nextValue) => {
    _setWebSearch((prev) => {
      const resolved = typeof nextValue === "function" ? nextValue(prev) : nextValue;
      const normalized = normalizeWebSearchSettings(resolved, {
        defaultEnabled: prev?.enabled === true,
      });
      writeLocalJson(UI_WEB_SEARCH_KEY, normalized);
      return normalized;
    });
  }, []);

  const setCompletionSoundVolume = useCallback((volume) => {
    _setCompletionSoundVolume(volume);
    writeLocalSetting(UI_COMPLETION_SOUND_VOLUME_KEY, String(volume));
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await apiJson("/api/settings");
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
      const data = await apiJson("/api/settings", {
        method: "POST",
        body: { name, content },
      });
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
      const data = await apiJson("/api/settings", {
        method: "DELETE",
        body: { promptId },
      });
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
      const data = await apiJson("/api/settings", {
        method: "PATCH",
        body: { promptId, name, content },
      });
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
      const data = await apiJson("/api/settings", {
        method: "PUT",
        body: { avatar: avatarUrl },
      });
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
    agentModel,
    isSettingsReady,
    setModel,
    setAgentModel,
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
