"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Globe, Pencil, Settings2, Trash2, X } from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import PromptEditorModal from "./PromptEditorModal";
import {
  AGENT_MODEL_ID,
  getModelConfig,
  getAgentDriverModels,
  MODEL_GROUP_ORDER,
  MODEL_GROUP_TITLES,
  normalizeAgentDriverModelId,
} from "@/lib/shared/models";
import { DEFAULT_WEB_SEARCH_SETTINGS } from "@/lib/shared/webSearch";

const AGENT_MODEL_OPTIONS = getAgentDriverModels();
export default function SettingsMenu({
  model,
  agentModel,
  setAgentModel,
  agentModelLocked = false,
  webSearch,
  setWebSearch,
  systemPrompts,
  activePromptIds,
  setActivePromptIds,
  activePromptId,
  setActivePromptId,
  onAddPrompt,
  onDeletePrompt,
  onUpdatePrompt,
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [showPromptList, setShowPromptList] = useState(false);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [promptModalMode, setPromptModalMode] = useState("create");
  const [promptModalPromptId, setPromptModalPromptId] = useState(null);
  const [promptModalName, setPromptModalName] = useState("");
  const [promptModalContent, setPromptModalContent] = useState("");
  const [promptModalSaving, setPromptModalSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmDanger, setConfirmDanger] = useState(false);
  const confirmActionRef = useRef(null);
  const promptListRef = useRef(null);

  const activePrompt = systemPrompts.find((prompt) => String(prompt?._id) === String(activePromptId));
  const activePromptName = activePrompt?.name || "无";
  const isAgentMode = model === AGENT_MODEL_ID;
  const normalizedAgentModel = normalizeAgentDriverModelId(agentModel);
  const webSearchSettings = webSearch && typeof webSearch === "object"
    ? { ...DEFAULT_WEB_SEARCH_SETTINGS, ...webSearch }
    : DEFAULT_WEB_SEARCH_SETTINGS;
  const modelConfig = getModelConfig(model);
  const supportsWebSearch = modelConfig?.supportsWebSearch === true;
  const agentModelGroups = MODEL_GROUP_ORDER
    .filter((groupKey) => groupKey !== "vectaix")
    .map((groupKey) => ({
      groupKey,
      title: MODEL_GROUP_TITLES[groupKey] || groupKey,
      models: AGENT_MODEL_OPTIONS.filter((item) => item.provider === groupKey),
    }))
    .filter((group) => group.models.length > 0);

  const updateWebSearch = (patch) => {
    setWebSearch((prev) => ({
      ...(prev && typeof prev === "object" ? prev : DEFAULT_WEB_SEARCH_SETTINGS),
      ...patch,
    }));
  };

  useEffect(() => {
    if (isAgentMode) {
      if (showPromptList) {
        setShowPromptList(false);
      }

      if (activePromptIds?.[model]) {
        setActivePromptIds?.((prev) => {
          const next = { ...(prev || {}) };
          delete next[model];
          return next;
        });
      }

      if (activePromptId != null) {
        setActivePromptId(null);
      }
      return;
    }

    if (!model || !Array.isArray(systemPrompts)) return;
    const promptIds = systemPrompts.map((prompt) => String(prompt?._id));

    if (activePromptId && promptIds.includes(String(activePromptId))) {
      return;
    }

    const rememberedId = activePromptIds?.[model];
    const rememberedMatch = rememberedId && promptIds.includes(String(rememberedId));

    if (rememberedMatch) {
      const nextId = String(rememberedId);
      if (String(activePromptId) !== nextId) {
        setActivePromptId(nextId);
      }
      return;
    }

    if (rememberedId) {
      setActivePromptIds?.((prev) => {
        const next = { ...(prev || {}) };
        delete next[model];
        return next;
      });
    }

    if (activePromptId != null) {
      setActivePromptId(null);
    }
  }, [isAgentMode, model, showPromptList, systemPrompts, activePromptId, activePromptIds, setActivePromptId, setActivePromptIds]);

  useEffect(() => {
    if (!showPromptList) return;
    const handleClickOutside = (event) => {
      if (!promptListRef.current) return;
      if (!promptListRef.current.contains(event.target)) {
        setShowPromptList(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPromptList]);

  const closePromptModal = () => {
    if (promptModalSaving) return;
    setPromptModalOpen(false);
    setPromptModalPromptId(null);
    setPromptModalName("");
    setPromptModalContent("");
    setPromptModalMode("create");
  };

  const openCreatePromptModal = () => {
    setShowPromptList(false);
    setPromptModalMode("create");
    setPromptModalPromptId(null);
    setPromptModalName("");
    setPromptModalContent("");
    setPromptModalOpen(true);
  };

  const openEditPromptModal = (prompt) => {
    if (!prompt) return;
    setShowPromptList(false);
    setPromptModalMode("edit");
    setPromptModalPromptId(String(prompt?._id));
    setPromptModalName(prompt?.name);
    setPromptModalContent(prompt?.content);
    setPromptModalOpen(true);
  };

  const savePromptModal = async () => {
    const name = promptModalName.trim();
    const content = promptModalContent.trim();
    if (!name || !content) return;
    if (promptModalMode === "edit" && !promptModalPromptId) return;
    setPromptModalSaving(true);
    try {
      if (promptModalMode === "create") {
        const settings = await onAddPrompt?.({ name, content });
        if (!settings) return;
        const prompts = settings.systemPrompts;
        if (Array.isArray(prompts) && prompts.length > 0) {
          const newPrompt = prompts[prompts.length - 1];
          if (newPrompt && newPrompt._id) {
            const nextId = String(newPrompt._id);
            setActivePromptId(nextId);
            setActivePromptIds?.((prev) => ({ ...prev, [model]: nextId }));
          }
        }
      } else {
        const settings = await onUpdatePrompt?.({
          promptId: promptModalPromptId,
          name,
          content,
        });
        if (!settings) return;
      }
      closePromptModal();
    } finally {
      setPromptModalSaving(false);
    }
  };

  const deletePromptById = async (promptId) => {
    if (!promptId) return;
    const settings = await onDeletePrompt?.(promptId);
    if (String(promptId) !== String(activePromptId)) return;
    if (!settings) return;
    setActivePromptId(null);
    setActivePromptIds?.((prev) => {
      const next = { ...(prev || {}) };
      delete next[model];
      return next;
    });
  };

  const requestDeletePromptById = (prompt) => {
    if (!prompt?._id) return;
    setShowPromptList(false);
    confirmActionRef.current = () => deletePromptById(String(prompt?._id));
    setConfirmTitle("删除提示词");
    setConfirmMessage(`确定要删除「${prompt?.name}」吗？此操作无法撤销。`);
    setConfirmDanger(true);
    setConfirmOpen(true);
  };

  const closeSettings = () => {
    if (confirmOpen) {
      setConfirmOpen(false);
      confirmActionRef.current = null;
      return;
    }
    setShowSettings(false);
    setShowPromptList(false);
    closePromptModal();
    confirmActionRef.current = null;
  };

  const toggleSettings = () => {
    if (showSettings) {
      closeSettings();
    } else {
      setShowSettings(true);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={toggleSettings}
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
              onClick={closeSettings}
            />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full left-0 mb-2 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 p-4 z-50 w-[min(92vw,360px)] max-w-[calc(100vw-2rem)] max-h-[72vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-3">
                <span className="font-medium text-zinc-900 dark:text-zinc-100 text-sm">设置</span>
                <button
                  onClick={closeSettings}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4">
                {model === AGENT_MODEL_ID && (
                  <div>
                    <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                      Agent 模型
                    </label>
                    <select
                      value={normalizedAgentModel}
                      onChange={(event) => setAgentModel?.(event.target.value)}
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={agentModelLocked}
                    >
                      {agentModelGroups.map((group) => (
                        <optgroup key={group.groupKey} label={group.title}>
                          {group.models.map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {agentModelLocked && (
                      <p className="mt-2 text-xs text-zinc-400">
                        Agent 已经开始回复，当前会话里不能再切换 Agent 模型。
                      </p>
                    )}
                  </div>
                )}

                {!isAgentMode && (
                  <div>
                    <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                      系统提示词
                    </label>
                    <div className="relative" ref={promptListRef}>
                      <button
                        onClick={() => setShowPromptList((value) => !value)}
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2.5 py-2 text-sm text-zinc-700 dark:text-zinc-300 flex items-center justify-between"
                        type="button"
                      >
                        <span className="truncate pr-2">{activePromptName}</span>
                        <ChevronDown size={16} className={`transition-transform ${showPromptList ? "rotate-180" : ""}`} />
                      </button>

                      <AnimatePresence>
                        {showPromptList && (
                          <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            className="absolute left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg p-1 z-10"
                          >
                            <div className="max-h-56 overflow-auto">
                              <div
                                className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${activePromptId == null ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
                              >
                                <button
                                  onClick={() => {
                                    setActivePromptId(null);
                                    setActivePromptIds?.((prev) => {
                                      const next = { ...(prev || {}) };
                                      delete next[model];
                                      return next;
                                    });
                                    setShowPromptList(false);
                                  }}
                                  className="flex-1 text-left text-sm text-zinc-700 dark:text-zinc-300 truncate"
                                  type="button"
                                >
                                  无
                                </button>
                              </div>

                              {systemPrompts.map((prompt) => {
                                const isActive = String(prompt?._id) === String(activePromptId);
                                return (
                                  <div
                                    key={prompt._id}
                                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isActive ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
                                  >
                                    <button
                                      onClick={() => {
                                        const nextId = String(prompt?._id);
                                        setActivePromptId(nextId);
                                        setActivePromptIds?.((prev) => ({ ...prev, [model]: nextId }));
                                        setShowPromptList(false);
                                      }}
                                      className="flex-1 text-left text-sm text-zinc-700 dark:text-zinc-300 truncate"
                                      type="button"
                                    >
                                      {prompt?.name}
                                    </button>
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => openEditPromptModal(prompt)}
                                        title="编辑提示词"
                                        className="p-1 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                        type="button"
                                      >
                                        <Pencil size={14} />
                                      </button>
                                      <button
                                        onClick={() => requestDeletePromptById(prompt)}
                                        title="删除提示词"
                                        className="p-1 text-zinc-500 hover:text-red-600"
                                        type="button"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                              {systemPrompts.length === 0 && (
                                <div className="px-2 py-2 text-xs text-zinc-400 dark:text-zinc-500">暂无提示词，请先新建</div>
                              )}
                            </div>
                            <button
                              onClick={openCreatePromptModal}
                              className="w-full mt-1 px-2 py-2 text-left text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md"
                              type="button"
                            >
                              + 新建提示词
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}

                {supportsWebSearch && (
                  <div>
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
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          confirmActionRef.current = null;
        }}
        onConfirm={async () => {
          try {
            await confirmActionRef.current?.();
          } finally {
            confirmActionRef.current = null;
            setConfirmOpen(false);
          }
        }}
        title={confirmTitle}
        message={confirmMessage}
        confirmText={confirmDanger ? "删除" : "确定"}
        cancelText="取消"
        danger={confirmDanger}
      />

      <PromptEditorModal
        open={promptModalOpen}
        title={promptModalMode === "create" ? "新建提示词" : "编辑提示词"}
        name={promptModalName}
        content={promptModalContent}
        onNameChange={setPromptModalName}
        onContentChange={setPromptModalContent}
        onClose={closePromptModal}
        onSave={savePromptModal}
        saving={promptModalSaving}
      />
    </div>
  );
}
