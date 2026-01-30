"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp, Globe, Pencil, Plus, Settings2, X } from "lucide-react";
import ConfirmModal from "./ConfirmModal";

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
  const [showAddPrompt, setShowAddPrompt] = useState(false);
  const [showEditPrompt, setShowEditPrompt] = useState(false);
  const [newPromptName, setNewPromptName] = useState("");
  const [newPromptContent, setNewPromptContent] = useState("");
  const [editPromptName, setEditPromptName] = useState("");
  const [editPromptContent, setEditPromptContent] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmDanger, setConfirmDanger] = useState(false);
  const confirmActionRef = useRef(null);

  const isOpenAIModel = typeof model === "string" && model.startsWith("gpt-");
  const maxTokenOptions = isOpenAIModel ? OPENAI_TOKEN_OPTIONS : GEMINI_TOKEN_OPTIONS;

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

  const addPrompt = async () => {
    if (!newPromptName.trim() || !newPromptContent.trim()) return;
    const settings = await onAddPrompt?.({
      name: newPromptName.trim(),
      content: newPromptContent.trim(),
    });
    if (!settings) return;

    const prompts = settings.systemPrompts;
    if (Array.isArray(prompts) && prompts.length > 0) {
      const newPrompt = prompts[prompts.length - 1];
      if (newPrompt && newPrompt._id) {
        const nextId = String(newPrompt._id);
        setActivePromptId(nextId);
        setActivePromptIds?.((prev) => ({ ...(prev || {}), [model]: nextId }));
      }
    }

    setNewPromptName("");
    setNewPromptContent("");
    setShowAddPrompt(false);
  };

  const deleteCurrentPrompt = async () => {
    if (!activePromptId || systemPrompts.length <= 1) return;
    const cur = systemPrompts.find((p) => String(p?._id) === String(activePromptId));
    if (cur?.name === "默认助手") return;
    await onDeletePrompt?.(activePromptId);
  };

  const requestDeleteCurrentPrompt = () => {
    if (!activePromptId || systemPrompts.length <= 1) return;
    const cur = systemPrompts.find((p) => String(p?._id) === String(activePromptId));
    if (cur?.name === "默认助手") return;
    confirmActionRef.current = deleteCurrentPrompt;
    setConfirmTitle("删除提示词");
    setConfirmMessage(`确定要删除「${cur?.name || ""}」吗？此操作无法撤销。`);
    setConfirmDanger(true);
    setConfirmOpen(true);
  };

  const openEditPrompt = () => {
    if (!activePromptId) return;
    const cur = systemPrompts.find((p) => String(p?._id) === String(activePromptId));
    if (cur?.name === "默认助手") return;
    setEditPromptName(cur?.name || "");
    setEditPromptContent(cur?.content || "");
    setShowAddPrompt(false);
    setNewPromptName("");
    setNewPromptContent("");
    setShowEditPrompt((v) => !v);
  };

  const updateCurrentPrompt = async () => {
    const name = editPromptName.trim();
    const content = editPromptContent.trim();
    if (!activePromptId || !name || !content) return;
    const settings = await onUpdatePrompt?.({ promptId: activePromptId, name, content });
    if (!settings) return;
    setShowEditPrompt(false);
  };

  const requestUpdateCurrentPrompt = () => {
    const name = editPromptName.trim();
    const content = editPromptContent.trim();
    if (!activePromptId || !name || !content) return;
    const cur = systemPrompts.find((p) => String(p?._id) === String(activePromptId));
    confirmActionRef.current = updateCurrentPrompt;
    setConfirmTitle("保存修改");
    setConfirmMessage(`确定要保存对「${cur?.name || ""}」的修改吗？`);
    setConfirmDanger(false);
    setConfirmOpen(true);
  };

  const closeSettings = () => {
    setShowSettings(false);
    setShowAdvancedSettings(false);
    setShowAddPrompt(false);
    setShowEditPrompt(false);
    setNewPromptName("");
    setNewPromptContent("");
    setEditPromptName("");
    setEditPromptContent("");
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
                {model?.startsWith("claude-") || model?.startsWith("gpt-") || model?.startsWith("o1-") ? (
                  <div>
                    <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                      系统提示词
                    </label>
                    <div className="bg-zinc-100 border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-400 cursor-not-allowed">
                      内置提示词（不可修改）
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                      系统提示词
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={activePromptId || ""}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          setActivePromptId(nextId);
                          setActivePromptIds?.((prev) => ({ ...(prev || {}), [model]: nextId }));
                        }}
                        className="flex-1 bg-zinc-50 border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-700"
                      >
                        {systemPrompts.map((p) => (
                          <option key={p._id} value={p._id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => setShowAddPrompt(!showAddPrompt)}
                        className="px-2.5 bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 rounded-lg text-zinc-600 transition-colors"
                        type="button"
                      >
                        <Plus size={16} />
                      </button>
                    </div>

                    <AnimatePresence>
                      {showAddPrompt && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-2 p-2.5 bg-zinc-50 rounded-lg border border-zinc-200 space-y-2">
                            <input
                              type="text"
                              placeholder="名称"
                              value={newPromptName}
                              onChange={(e) => setNewPromptName(e.target.value)}
                              className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-400"
                            />
                            <textarea
                              placeholder="提示词内容..."
                              value={newPromptContent}
                              onChange={(e) => setNewPromptContent(e.target.value)}
                              className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm resize-none focus:outline-none focus:border-zinc-400"
                              rows={2}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={addPrompt}
                                className="flex-1 bg-zinc-600 hover:bg-zinc-500 text-white text-xs py-1.5 rounded-lg transition-colors"
                                type="button"
                              >
                                添加
                              </button>
                              <button
                                onClick={() => {
                                  setShowAddPrompt(false);
                                  setNewPromptName("");
                                  setNewPromptContent("");
                                }}
                                className="px-3 bg-zinc-200 hover:bg-zinc-300 text-zinc-600 text-xs py-1.5 rounded-lg transition-colors"
                                type="button"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {(() => {
                      const cur = systemPrompts.find((p) => String(p?._id) === String(activePromptId));
                      const isGemini = model?.startsWith("gemini-");
                      const isDefault = cur?.name === "默认助手";
                      const hideActions = isGemini && isDefault;
                      if (!activePromptId || hideActions) return null;
                      return (
                        <div className="mt-2 flex items-center justify-between gap-2">
                          {(() => {
                            if (cur?.name === "默认助手") {
                              return <span className="text-[11px] text-zinc-400">默认提示词不可删除</span>;
                            }
                            if (systemPrompts.length <= 1) {
                              return <span className="text-[11px] text-zinc-400">仅剩 1 个提示词不可删除</span>;
                            }
                            return (
                              <button
                                onClick={requestDeleteCurrentPrompt}
                                className="text-xs text-red-500 hover:text-red-600"
                                type="button"
                              >
                                删除当前提示词
                              </button>
                            );
                          })()}

                          {(() => {
                            if (cur?.name === "默认助手") {
                              return <span className="text-[11px] text-zinc-400">默认提示词不可编辑</span>;
                            }
                            return (
                              <button
                                onClick={openEditPrompt}
                                className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-800"
                                type="button"
                              >
                                <Pencil size={14} />
                                编辑当前提示词
                              </button>
                            );
                          })()}
                        </div>
                      );
                    })()}

                    <AnimatePresence>
                      {showEditPrompt && activePromptId && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-2 p-2.5 bg-zinc-50 rounded-lg border border-zinc-200 space-y-2">
                            <input
                              type="text"
                              placeholder="名称"
                              value={editPromptName}
                              onChange={(e) => setEditPromptName(e.target.value)}
                              className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-400"
                            />
                            <textarea
                              placeholder="提示词内容..."
                              value={editPromptContent}
                              onChange={(e) => setEditPromptContent(e.target.value)}
                              className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm resize-none focus:outline-none focus:border-zinc-400"
                              rows={3}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={requestUpdateCurrentPrompt}
                                className="flex-1 bg-zinc-600 hover:bg-zinc-500 text-white text-xs py-1.5 rounded-lg transition-colors"
                                type="button"
                              >
                                保存
                              </button>
                              <button
                                onClick={() => setShowEditPrompt(false)}
                                className="px-3 bg-zinc-200 hover:bg-zinc-300 text-zinc-600 text-xs py-1.5 rounded-lg transition-colors"
                                type="button"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
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
                              {historyLimit || "无限制"} 条
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
                                {{ minimal: "最小", low: "快速", medium: "平衡", high: "深度" }[thinkingLevel] || "深度"}
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
                                {{ none: "无", low: "低", medium: "中", high: "高", xhigh: "超高" }[thinkingLevel] || "中"}
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
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => confirmActionRef.current?.()}
        title={confirmTitle}
        message={confirmMessage}
        confirmText={confirmDanger ? "删除" : "确定"}
        cancelText="取消"
        danger={confirmDanger}
      />
    </div>
  );
}
