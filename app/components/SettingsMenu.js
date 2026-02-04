"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, Globe, Pencil, Settings2, Trash2, X } from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import PromptEditorModal from "./PromptEditorModal";

const OPENAI_TOKEN_OPTIONS = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 128000];
const GEMINI_TOKEN_OPTIONS = [1024, 2048, 4096, 8192, 16384, 32768, 65536];
const CLAUDE_TOKEN_OPTIONS = [1000, 2000, 4000, 8000, 16000, 32000, 64000];
const GEMINI_FLASH_THINKING_LEVELS = ["minimal", "low", "medium", "high"];
const GEMINI_PRO_THINKING_LEVELS = ["low", "high"];
const GPT_THINKING_LEVELS = ["none", "low", "medium", "high", "xhigh"];

export default function SettingsMenu({
  model,
  thinkingLevel,
  setThinkingLevel,
  historyLimit,
  setHistoryLimit,
  maxTokens,
  setMaxTokens,
  budgetTokens,
  setBudgetTokens,
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
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
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

  const isOpenAIModel = typeof model === "string" && model.startsWith("gpt-");
  const maxTokenOptions = isOpenAIModel ? OPENAI_TOKEN_OPTIONS : GEMINI_TOKEN_OPTIONS;
  const activePrompt = systemPrompts.find((p) => String(p?._id) === String(activePromptId));
  const activePromptName = activePrompt?.name;

  useEffect(() => {
    if (!model) return;
    if (model === "gemini-3-flash-preview") {
      if (!GEMINI_FLASH_THINKING_LEVELS.includes(thinkingLevel)) {
        setThinkingLevel("high");
      }
      return;
    }
    if (model === "gemini-3-pro-preview") {
      if (!GEMINI_PRO_THINKING_LEVELS.includes(thinkingLevel)) {
        setThinkingLevel("high");
      }
      return;
    }
    if (model.startsWith("gpt-")) {
      if (!GPT_THINKING_LEVELS.includes(thinkingLevel)) {
        setThinkingLevel("medium");
      }
    }
  }, [model, thinkingLevel, setThinkingLevel]);

  useEffect(() => {
    const options = model?.startsWith("claude-") ? CLAUDE_TOKEN_OPTIONS : maxTokenOptions;
    if (!options.includes(maxTokens)) {
      setMaxTokens(options[options.length - 1]);
    }
  }, [model, maxTokens, maxTokenOptions, setMaxTokens]);

  useEffect(() => {
    if (!model || !Array.isArray(systemPrompts) || systemPrompts.length === 0) return;
    const promptIds = systemPrompts.map((p) => String(p?._id));
    
    // 如果当前 activePromptId 有效，不自动切换
    if (activePromptId && promptIds.includes(String(activePromptId))) {
      return;
    }
    
    const rememberedId = activePromptIds?.[model];
    const rememberedMatch = rememberedId && promptIds.includes(String(rememberedId));
    const defaultPrompt = systemPrompts.find((p) => p?.name === "默认助手");
    const defaultId = String(defaultPrompt?._id);
    const nextId = rememberedMatch
      ? String(rememberedId)
      : defaultId;
    if (!nextId) return;
    if (String(activePromptId) !== nextId) {
      setActivePromptId(nextId);
    }
    if (String(rememberedId) !== nextId) {
      setActivePromptIds?.((prev) => ({ ...prev, [model]: nextId }));
    }
  }, [model, systemPrompts, activePromptId, activePromptIds, setActivePromptId, setActivePromptIds]);

  useEffect(() => {
    if (!showPromptList) return;
    const handleClickOutside = (e) => {
      if (!promptListRef.current) return;
      if (!promptListRef.current.contains(e.target)) {
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
    if (!prompt || prompt?.name === "默认助手") return;
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
    const cur = systemPrompts.find((p) => String(p?._id) === String(promptId));
    if (cur?.name === "默认助手") return;
    const settings = await onDeletePrompt?.(promptId);
    if (String(promptId) !== String(activePromptId)) return;
    const prompts = settings?.systemPrompts;
    if (Array.isArray(prompts) && prompts.length > 0) {
      const defaultPrompt = prompts.find((p) => p?.name === "默认助手");
      const nextId = String(defaultPrompt?._id);
      if (nextId) {
        setActivePromptId(nextId);
        setActivePromptIds?.((prev) => ({ ...prev, [model]: nextId }));
      }
    }
  };

  const requestDeletePromptById = (prompt) => {
    if (!prompt?._id) return;
    if (prompt?.name === "默认助手") return;
    setShowPromptList(false);
    confirmActionRef.current = () => deletePromptById(String(prompt?._id));
    setConfirmTitle("删除提示词");
    setConfirmMessage(`确定要删除「${prompt?.name}」吗？此操作无法撤销。`);
    setConfirmDanger(true);
    setConfirmOpen(true);
  };

  const closeSettings = () => {
    // 如果确认弹窗是打开的，先关闭弹窗并清空 action，不执行其他清理
    if (confirmOpen) {
      setConfirmOpen(false);
      confirmActionRef.current = null;
      return;
    }
    setShowSettings(false);
    setShowAdvancedSettings(false);
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
          ? "bg-zinc-100 border-zinc-300 text-zinc-700"
          : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
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
              className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-zinc-200 p-4 z-50 w-64"
            >
              <div className="flex justify-between items-center mb-3">
                <span className="font-medium text-zinc-900 text-sm">
                  设置
                </span>
                <button
                  onClick={closeSettings}
                  className="text-zinc-400 hover:text-zinc-600"
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4">
                {model?.startsWith("claude-") || model?.startsWith("gpt-") ? null : (
                  <div>
                    <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                      系统提示词
                    </label>
                    <div className="relative" ref={promptListRef}>
                      <button
                        onClick={() => setShowPromptList((v) => !v)}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 text-sm text-zinc-700 flex items-center justify-between"
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
                            className="absolute left-0 right-0 mt-2 bg-white border border-zinc-200 rounded-lg shadow-lg p-1 z-10"
                          >
                            <div className="max-h-56 overflow-auto">
                              {systemPrompts.map((p) => {
                                const isDefault = p?.name === "默认助手";
                                const isActive = String(p?._id) === String(activePromptId);
                                return (
                                  <div
                                    key={p._id}
                                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isActive ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
                                  >
                                    <button
                                      onClick={() => {
                                        const nextId = String(p?._id);
                                        setActivePromptId(nextId);
                                        setActivePromptIds?.((prev) => ({ ...prev, [model]: nextId }));
                                        setShowPromptList(false);
                                      }}
                                      className="flex-1 text-left text-sm text-zinc-700 truncate"
                                      type="button"
                                    >
                                      {p?.name}
                                    </button>
                                    {isDefault ? (
                                      <div className="w-12" />
                                    ) : (
                                      <div className="flex items-center gap-1">
                                        <button
                                          onClick={() => openEditPromptModal(p)}
                                          title="编辑提示词"
                                          className="p-1 text-zinc-500 hover:text-zinc-700"
                                          type="button"
                                        >
                                          <Pencil size={14} />
                                        </button>
                                        <button
                                          onClick={() => requestDeletePromptById(p)}
                                          title="删除提示词"
                                          className="p-1 text-zinc-500 hover:text-red-600"
                                          type="button"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <button
                              onClick={openCreatePromptModal}
                              className="w-full mt-1 px-2 py-2 text-left text-sm text-zinc-600 hover:text-zinc-800 hover:bg-zinc-50 rounded-md"
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

                <div>
                  <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                    智能联网
                  </label>
                  <button
                    onClick={() => setWebSearch(!webSearch)}
                    type="button"
                    className={`px-3 py-1 rounded-lg border transition-colors text-sm flex items-center gap-1.5 ${webSearch
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                      }`}
                  >
                    <Globe size={14} />
                    {webSearch ? "开" : "关"}
                  </button>
                </div>

                <div className="border-t border-zinc-200 pt-3">
                  <button
                    onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                    type="button"
                    className="w-full flex items-center justify-between text-sm text-zinc-600 hover:text-zinc-800 transition-colors"
                  >
                    <span className="font-medium">高级设置</span>
                    <ChevronUp
                      size={16}
                      className={`transition-transform ${showAdvancedSettings ? "" : "rotate-180"}`}
                    />
                  </button>

                  <AnimatePresence>
                    {showAdvancedSettings && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="pt-3 space-y-4">
                          <div>
                            <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                              历史限制
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="20"
                              step="2"
                              value={historyLimit}
                              onChange={(e) => setHistoryLimit(Number(e.target.value))}
                              className="w-full accent-zinc-900 h-1 bg-zinc-200 rounded-full"
                            />
                            <span className="text-xs text-right block mt-1 text-zinc-600">
                              {historyLimit === 0 ? "∞" : `${historyLimit} 条`}
                            </span>
                          </div>

                          {model === "gemini-3-flash-preview" ? (
                            <div>
                              <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                                思考深度
                              </label>
                              <input
                                type="range"
                                min="0"
                                max="3"
                                step="1"
                                value={Math.max(0, GEMINI_FLASH_THINKING_LEVELS.indexOf(thinkingLevel))}
                                onChange={(e) => setThinkingLevel(GEMINI_FLASH_THINKING_LEVELS[e.target.value])}
                                className="w-full accent-zinc-900 h-1 bg-zinc-200 rounded-full"
                              />
                              <span className="text-xs text-right block mt-1 text-zinc-600">
                                {{ minimal: "最小", low: "快速", medium: "平衡", high: "深度" }[thinkingLevel]}
                              </span>
                            </div>
                          ) : model === "gemini-3-pro-preview" ? (
                            <div>
                              <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                                思考深度
                              </label>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="1"
                                value={thinkingLevel === "high" ? 1 : 0}
                                onChange={(e) => setThinkingLevel(e.target.value === "1" ? "high" : "low")}
                                className="w-full accent-zinc-900 h-1 bg-zinc-200 rounded-full"
                              />
                              <span className="text-xs text-right block mt-1 text-zinc-600">
                                {thinkingLevel === "high" ? "深度" : "快速"}
                              </span>
                            </div>
                          ) : model?.startsWith("claude-") ? (
                            <>
                              <div>
                                <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                                  思考深度
                                </label>
                                  <input
                                    type="range"
                                    min="0"
                                    max="6"
                                    step="1"
                                    value={Math.max(0, CLAUDE_TOKEN_OPTIONS.indexOf(budgetTokens))}
                                    onChange={(e) => setBudgetTokens(CLAUDE_TOKEN_OPTIONS[e.target.value])}
                                    className="w-full accent-zinc-900 h-1 bg-zinc-200 rounded-full"
                                  />
                                <span className="text-xs text-right block mt-1 text-zinc-600">
                                  {budgetTokens >= 1000 ? `${Math.round(budgetTokens / 1000)}K` : budgetTokens}
                                </span>
                              </div>
                              <div>
                                <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                                  最大输出
                                </label>
                                  <input
                                    type="range"
                                    min="0"
                                    max="6"
                                    step="1"
                                    value={Math.max(0, CLAUDE_TOKEN_OPTIONS.indexOf(maxTokens))}
                                    onChange={(e) => setMaxTokens(CLAUDE_TOKEN_OPTIONS[e.target.value])}
                                    className="w-full accent-zinc-900 h-1 bg-zinc-200 rounded-full"
                                  />
                                <span className="text-xs text-right block mt-1 text-zinc-600">
                                  {maxTokens >= 1000 ? `${Math.round(maxTokens / 1000)}K` : maxTokens}
                                </span>
                              </div>
                            </>
                          ) : model?.startsWith("gpt-") ? (
                            <div>
                              <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                                思考深度
                              </label>
                              <input
                                type="range"
                                min="0"
                                max="4"
                                step="1"
                                value={(() => {
                                  const idx = ["none", "low", "medium", "high", "xhigh"].indexOf(thinkingLevel);
                                  return idx >= 0 ? idx : 2;
                                })()}
                                onChange={(e) => setThinkingLevel(["none", "low", "medium", "high", "xhigh"][Number(e.target.value)])}
                                className="w-full accent-zinc-900 h-1 bg-zinc-200 rounded-full"
                              />
                              <span className="text-xs text-right block mt-1 text-zinc-600">
                                {{ none: "无", low: "低", medium: "中", high: "高", xhigh: "超高" }[thinkingLevel]}
                              </span>
                            </div>
                          ) : null}

                          {!model?.startsWith("claude-") && (
                            <div>
                              <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                                最大输出
                              </label>
                                      <input
                                        type="range"
                                        min="0"
                                        max={maxTokenOptions.length - 1}
                                        step="1"
                                        value={Math.max(0, maxTokenOptions.indexOf(maxTokens))}
                                        onChange={(e) => setMaxTokens(maxTokenOptions[e.target.value])}
                                        className="w-full accent-zinc-900 h-1 bg-zinc-200 rounded-full"
                                      />
                              <span className="text-xs text-right block mt-1 text-zinc-600">
                                {isOpenAIModel
                                  ? (maxTokens >= 1000 ? `${Math.round(maxTokens / 1000)}K` : maxTokens)
                                  : (maxTokens >= 1024 ? `${Math.round(maxTokens / 1024)}K` : maxTokens)}
                              </span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
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
