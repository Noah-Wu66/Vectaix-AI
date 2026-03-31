"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Globe, Settings2, X, MessageSquareQuote } from "lucide-react";
import { CHAT_RUNTIME_MODE_CHAT, getModelConfig } from "@/lib/shared/models";
import { DEFAULT_WEB_SEARCH_SETTINGS } from "@/lib/shared/webSearch";
import ModelSelector from "./ModelSelector";
import { useToast } from "./ToastProvider";
import SystemPromptModal from "./SystemPromptModal";

export default function SettingsMenu({
  model,
  chatMode,
  onModelChange,
  ready = true,
  webSearch,
  setWebSearch,
  chatSystemPrompt,
  onChatSystemPromptSave,
  systemPrompts,
  addSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
}) {
  const toast = useToast();
  const [showSettings, setShowSettings] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const modelConfig = getModelConfig(model);
  const supportsWebSearch = modelConfig?.supportsWebSearch === true;
  const isChatMode = chatMode === CHAT_RUNTIME_MODE_CHAT;
  const webSearchSettings = webSearch && typeof webSearch === "object"
    ? { ...DEFAULT_WEB_SEARCH_SETTINGS, ...webSearch }
    : DEFAULT_WEB_SEARCH_SETTINGS;

  const updateWebSearch = (patch) => {
    setWebSearch((prev) => ({
      ...(prev && typeof prev === "object" ? prev : DEFAULT_WEB_SEARCH_SETTINGS),
      ...patch,
    }));
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowSettings((value) => !value)}
        className={`px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 text-sm ${showSettings
          ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300"
          : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          }`}
        type="button"
      >
        <Settings2 size={14} />
        <span className="hidden sm:inline">设置</span>
      </button>

      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setShowSettings(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full left-0 mb-2 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 p-4 z-50 w-[min(92vw,264px)] max-w-[calc(100vw-2rem)]"
            >
              <div className="flex justify-between items-center mb-3">
                <span className="font-medium text-zinc-900 dark:text-zinc-100 text-sm">设置</span>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                    模型
                  </label>
                  <ModelSelector
                    model={model}
                    onModelChange={onModelChange}
                    ready={ready}
                    includeCouncil={false}
                    fullWidth
                  />
                </div>

                {supportsWebSearch ? (
                  <div>
                    <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                      联网搜索
                    </label>
                    <button
                      onClick={() => updateWebSearch({ enabled: !webSearchSettings.enabled })}
                      type="button"
                      className={`px-3 py-1 rounded-lg border transition-colors text-sm flex items-center gap-1.5 ${webSearchSettings.enabled
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        }`}
                    >
                      <Globe size={14} />
                      {webSearchSettings.enabled ? "开" : "关"}
                    </button>
                  </div>
                ) : null}

                {isChatMode ? (
                  <div>
                    <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                      系统提示词
                    </label>
                    <button
                      onClick={() => setShowPromptModal(true)}
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-colors text-sm bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      <span className="flex items-center gap-2">
                        <MessageSquareQuote size={14} />
                        配置提示词
                      </span>
                      <span className="text-[10px] bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded text-zinc-500 font-medium">
                        {chatSystemPrompt ? "已设置" : "默认无"}
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <SystemPromptModal
        open={showPromptModal}
        onClose={() => setShowPromptModal(false)}
        chatSystemPrompt={chatSystemPrompt}
        onChatSystemPromptSave={onChatSystemPromptSave}
        systemPrompts={systemPrompts}
        addSystemPrompt={addSystemPrompt}
        updateSystemPrompt={updateSystemPrompt}
        deleteSystemPrompt={deleteSystemPrompt}
      />
    </div>
  );
}
