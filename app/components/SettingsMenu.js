"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Globe, Settings2, X, MessageSquareQuote } from "lucide-react";
import { getModelConfig } from "@/lib/shared/models";
import { DEFAULT_WEB_SEARCH_SETTINGS } from "@/lib/shared/webSearch";
import ModelSelector from "./ModelSelector";
import { useToast } from "./ToastProvider";
import SystemPromptModal from "./SystemPromptModal";

export default function SettingsMenu({
  model,
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
            {/* 背景遮罩 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/30"
              onClick={() => setShowSettings(false)}
            />
            {/* 全屏弹窗 */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-0 z-50 bg-white dark:bg-zinc-900 sm:inset-4 sm:rounded-2xl sm:shadow-2xl flex flex-col"
            >
              {/* 标题栏 */}
              <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
                <span className="font-medium text-lg text-zinc-900 dark:text-zinc-100">设置</span>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-2 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  type="button"
                >
                  <X size={20} />
                </button>
              </div>

              {/* 内容区域 */}
              <div className="flex-1 overflow-auto p-4 sm:p-6">
                <div className="max-w-2xl mx-auto space-y-6">
                  {/* 模型选择 */}
                  <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 sm:p-5">
                    <label className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3 block">
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

                  {/* 联网搜索 */}
                  {supportsWebSearch ? (
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 sm:p-5">
                      <label className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3 block">
                        联网搜索
                      </label>
                      <button
                        onClick={() => updateWebSearch({ enabled: !webSearchSettings.enabled })}
                        type="button"
                        className={`px-4 py-2 rounded-lg border transition-colors text-sm flex items-center gap-2 ${webSearchSettings.enabled
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                          }`}
                      >
                        <Globe size={16} />
                        {webSearchSettings.enabled ? "开启" : "关闭"}
                      </button>
                    </div>
                  ) : null}

                  {/* 系统提示词 */}
                  <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 sm:p-5">
                    <label className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3 block">
                      系统提示词
                    </label>
                    <button
                      onClick={() => setShowPromptModal(true)}
                      type="button"
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors text-sm bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      <span className="flex items-center gap-2">
                        <MessageSquareQuote size={16} />
                        配置提示词
                      </span>
                      <span className="text-xs bg-zinc-100 dark:bg-zinc-700 px-2 py-1 rounded-full text-zinc-500 font-medium">
                        {chatSystemPrompt ? "已设置" : "默认无"}
                      </span>
                    </button>
                  </div>
                </div>
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
