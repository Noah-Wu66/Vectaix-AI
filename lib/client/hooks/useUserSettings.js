"use client";

import { useCallback, useEffect, useState } from "react";
import {
  UI_CHAT_MODE_KEY,
  UI_COMPLETION_SOUND_VOLUME_KEY,
  UI_FONT_SIZE_KEY,
  UI_MODEL_KEY,
  UI_THEME_MODE_KEY,
  UI_WEB_SEARCH_KEY,
} from "@/lib/shared/storageKeys";
import {
  DEFAULT_CHAT_RUNTIME_MODE,
  DEFAULT_MODEL,
  DEFAULT_THINKING_LEVELS,
  getDefaultMaxTokensForModel,
  isPrimaryChatModelId,
  normalizeChatRuntimeMode,
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

export function useUserSettings() {
  const [model, _setModel] = useState(DEFAULT_MODEL);
  const [chatMode, _setChatMode] = useState(DEFAULT_CHAT_RUNTIME_MODE);
  const [isSettingsReady, setIsSettingsReady] = useState(false);
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
    const localChatMode = readLocalSetting(UI_CHAT_MODE_KEY);
    const localWebSearch = readLocalJson(UI_WEB_SEARCH_KEY);
    const localCompletionSoundVolume = readLocalSetting(UI_COMPLETION_SOUND_VOLUME_KEY);

    const initialModel = typeof localModel === "string" && isPrimaryChatModelId(localModel)
      ? localModel
      : DEFAULT_MODEL;

    if (typeof localTheme === "string") _setThemeMode(localTheme);
    if (typeof localFont === "string") _setFontSize(localFont);
    _setModel(initialModel);
    writeLocalSetting(UI_MODEL_KEY, initialModel);
    _setChatMode(normalizeChatRuntimeMode(localChatMode));
    writeLocalSetting(UI_CHAT_MODE_KEY, normalizeChatRuntimeMode(localChatMode));
    _setWebSearch(normalizeWebSearchSettings(localWebSearch, { defaultEnabled: true }));
    if (localCompletionSoundVolume !== null) {
      const parsed = Number(localCompletionSoundVolume);
      _setCompletionSoundVolume(Number.isFinite(parsed) ? parsed : DEFAULT_COMPLETION_SOUND_VOLUME);
    }
    setIsSettingsReady(true);
  }, []);

  const setModel = useCallback((nextModel) => {
    _setModel(nextModel);
    writeLocalSetting(UI_MODEL_KEY, nextModel);
  }, []);

  const setChatMode = useCallback((nextMode) => {
    const normalized = normalizeChatRuntimeMode(nextMode);
    _setChatMode(normalized);
    writeLocalSetting(UI_CHAT_MODE_KEY, normalized);
  }, []);

  const setThemeMode = useCallback((mode) => {
    _setThemeMode(mode);
    writeLocalSetting(UI_THEME_MODE_KEY, mode);
  }, []);

  const setFontSize = useCallback((size) => {
    _setFontSize(size);
    writeLocalSetting(UI_FONT_SIZE_KEY, size);
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
      if (settings.avatar !== undefined) {
        _setAvatar(settings.avatar);
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
    chatMode,
    isSettingsReady,
    setModel,
    setChatMode,
    thinkingLevels,
    historyLimit,
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
    avatar,
    setAvatar,
  };
}
