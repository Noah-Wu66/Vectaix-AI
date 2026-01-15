"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronUp,
  Globe,
  Pencil,
  Paperclip,
  Plus,
  Send,
  Square,
  Settings2,
  X,
} from "lucide-react";
import { Gemini, Claude, OpenAI } from "@lobehub/icons";
import { CHAT_MODELS } from "./ChatModels";

// 根据 provider 渲染模型图标
function ModelIcon({ provider, Icon, size = 16, isSelected = false }) {
  if (provider === "gemini") {
    return <Gemini.Color size={size} />;
  }
  if (provider === "claude") {
    return <Claude.Color size={size} />;
  }
  if (provider === "openai") {
    return <OpenAI size={size} />;
  }
  if (Icon) {
    return <Icon size={size} className={isSelected ? "" : "text-blue-400"} />;
  }
  return null;
}
export default function Composer({
  loading,
  isStreaming,
  isWaitingForAI,
  model,
  onModelChange,
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
  onSend,
  onStop,
}) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddPrompt, setShowAddPrompt] = useState(false);
  const [showEditPrompt, setShowEditPrompt] = useState(false);
  const [newPromptName, setNewPromptName] = useState("");
  const [newPromptContent, setNewPromptContent] = useState("");
  const [editPromptName, setEditPromptName] = useState("");
  const [editPromptContent, setEditPromptContent] = useState("");
  const [input, setInput] = useState("");
  const [selectedImages, setSelectedImages] = useState([]);
  const [isMainInputFocused, setIsMainInputFocused] = useState(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const currentModel = CHAT_MODELS.find((m) => m.id === model);
  // 移动端键盘弹出时，同步可视高度，避免键盘遮挡输入区（尤其是 iOS Safari）
  // 只在主对话输入框聚焦时才启用此调整，编辑系统提示词时不调整
  useEffect(() => {
    const setAppHeight = () => {
      const vv = window.visualViewport;
      if (isMainInputFocused) {
        document.documentElement.style.setProperty("--app-height", `${Math.round(vv?.height || window.innerHeight)}px`);
        document.documentElement.style.setProperty("--app-offset-top", `${Math.round(vv?.offsetTop || 0)}px`);
      } else {
        // 非主输入框聚焦时，重置为默认值
        document.documentElement.style.setProperty("--app-height", "100dvh");
        document.documentElement.style.setProperty("--app-offset-top", "0px");
      }
    };
    setAppHeight();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", setAppHeight);
    vv?.addEventListener("scroll", setAppHeight);
    window.addEventListener("resize", setAppHeight);
    return () => {
      vv?.removeEventListener("resize", setAppHeight);
      vv?.removeEventListener("scroll", setAppHeight);
      window.removeEventListener("resize", setAppHeight);
    };
  }, [isMainInputFocused]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto"; const sh = el.scrollHeight; el.style.height = `${Math.min(sh, 160)}px`; el.style.overflowY = sh > 160 ? "auto" : "hidden";
  }, [input, model]);
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // 计算还能添加多少张图片（最多4张）
    const remainingSlots = 4 - selectedImages.length;
    const filesToAdd = files.slice(0, remainingSlots);

    filesToAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (!mountedRef.current) return;
        setSelectedImages((prev) => {
          if (prev.length >= 4) return prev;
          return [
            ...prev,
            {
              file,
              preview: ev.target.result,
              name: file.name,
              id: `${Date.now()}-${Math.random()}`,
            },
          ];
        });
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (imageId) => {
    setSelectedImages((prev) => prev.filter((img) => img.id !== imageId));
  };

  const clearAllImages = () => {
    setSelectedImages([]);
  };

  const handleKeyDown = (e) => {
    // 全设备统一：Enter 换行，Shift + Enter 发送
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      if (!loading) handleSend();
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if ((!text && selectedImages.length === 0) || loading) return;
    onSend({ text, images: selectedImages });
    setInput("");
    clearAllImages();
  };

  const addPrompt = async () => {
    if (!newPromptName.trim() || !newPromptContent.trim()) return;
    const settings = await onAddPrompt?.({
      name: newPromptName.trim(),
      content: newPromptContent.trim(),
    });
    if (!settings) return;
    setNewPromptName("");
    setNewPromptContent("");
    setShowAddPrompt(false);
  };

  const deleteCurrentPrompt = async () => {
    if (!activePromptId || systemPrompts.length <= 1) return;
    await onDeletePrompt?.(activePromptId);
  };

  const openEditPrompt = () => {
    if (!activePromptId) return;
    const cur = systemPrompts.find((p) => String(p?._id) === String(activePromptId));
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

  return (
    <div className="p-3 md:p-4 bg-white border-t border-zinc-200 z-20 shrink-0 pb-safe">
      <div className="max-w-3xl mx-auto space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowModelMenu(!showModelMenu)}
              className="px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors flex items-center gap-1.5 text-sm"
              type="button"
            >
              {currentModel && (
                <ModelIcon
                  provider={currentModel.provider}
                  Icon={currentModel.Icon}
                  size={14}
                  isSelected={true}
                />
              )}
              <span className="hidden sm:inline">{currentModel?.shortName}</span>
              <ChevronUp
                size={12}
                className={`transition-transform ${
                  showModelMenu ? "rotate-180" : ""
                }`}
              />
            </button>

            <AnimatePresence>
              {showModelMenu && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-40"
                    onClick={() => setShowModelMenu(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-zinc-200 p-2 z-50 min-w-[160px]"
                  >
                    {/* Gemini 分组 */}
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Gemini</div>
                    {CHAT_MODELS.filter((m) => m.provider === "gemini").map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setShowModelMenu(false);
                          onModelChange(m.id);
                        }}
                        className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2.5 transition-colors ${
                          model === m.id
                            ? "bg-zinc-600 text-white"
                            : "text-zinc-600 hover:bg-zinc-50"
                        }`}
                        type="button"
                      >
                        <ModelIcon provider={m.provider} size={16} isSelected={model === m.id} />
                        {m.name}
                      </button>
                    ))}

                    {/* 分隔线 */}
                    <div className="my-1.5 border-t border-zinc-200" />

                    {/* Claude 分组 */}
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Claude</div>
                    {CHAT_MODELS.filter((m) => m.provider === "claude").map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setShowModelMenu(false);
                          onModelChange(m.id);
                        }}
                        className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2.5 transition-colors ${
                          model === m.id
                            ? "bg-zinc-600 text-white"
                            : "text-zinc-600 hover:bg-zinc-50"
                        }`}
                        type="button"
                      >
                        <ModelIcon provider={m.provider} size={16} isSelected={model === m.id} />
                        {m.name}
                      </button>
                    ))}

                    {/* 分隔线 */}
                    <div className="my-1.5 border-t border-zinc-200" />

                    {/* OpenAI 分组 */}
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">OpenAI</div>
                    {CHAT_MODELS.filter((m) => m.provider === "openai").map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setShowModelMenu(false);
                          onModelChange(m.id);
                        }}
                        className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2.5 transition-colors ${
                          model === m.id
                            ? "bg-zinc-600 text-white"
                            : "text-zinc-600 hover:bg-zinc-50"
                        }`}
                        type="button"
                      >
                        <ModelIcon provider={m.provider} size={16} isSelected={model === m.id} />
                        {m.name}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 text-sm ${
                showSettings
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
                    onClick={() => setShowSettings(false)}
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
                        onClick={() => setShowSettings(false)}
                        className="text-zinc-400 hover:text-zinc-600"
                        type="button"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="space-y-4">
                      {/* System prompts */}
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
                                  onChange={(e) =>
                                    setNewPromptContent(e.target.value)
                                  }
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

                        {activePromptId && (
                          <div className="mt-2 flex items-center justify-between gap-2">
                            {systemPrompts.length > 1 ? (
                              <button
                                onClick={deleteCurrentPrompt}
                                className="text-xs text-red-500 hover:text-red-600"
                                type="button"
                              >
                                删除当前提示词
                              </button>
                            ) : (
                              <span className="text-[11px] text-zinc-400">仅剩 1 个提示词不可删除</span>
                            )}

                            <button
                              onClick={openEditPrompt}
                              className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-800"
                              type="button"
                            >
                              <Pencil size={14} />
                              编辑当前提示词
                            </button>
                          </div>
                        )}

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
                                    onClick={updateCurrentPrompt}
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

                      {/* History limit */}
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

                      {/* Model-specific settings */}
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
                            value={["minimal", "low", "medium", "high"].indexOf(thinkingLevel)}
                            onChange={(e) => setThinkingLevel(["minimal", "low", "medium", "high"][e.target.value])}
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
                              value={[1024, 2048, 4096, 8192, 16384, 32768, 65536].indexOf(budgetTokens)}
                              onChange={(e) => setBudgetTokens([1024, 2048, 4096, 8192, 16384, 32768, 65536][e.target.value])}
                              className="w-full accent-zinc-900 h-1 bg-zinc-200 rounded-full"
                            />
                            <span className="text-xs text-right block mt-1 text-zinc-600">
                              {budgetTokens >= 1024 ? `${Math.round(budgetTokens / 1024)}K` : budgetTokens}
                            </span>
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                              联网搜索
                            </label>
                            <button
                              onClick={() => setWebSearch(!webSearch)}
                              type="button"
                              className={`px-3 py-1 rounded-lg border transition-colors text-sm flex items-center gap-1.5 ${
                                webSearch
                                  ? "bg-blue-600 text-white border-blue-600"
                                  : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                              }`}
                            >
                              <Globe size={14} />
                              {webSearch ? "开" : "关"}
                            </button>
                          </div>
                        </>
                      ) : model?.startsWith("gpt-") ? (
                        <>
                          <div>
                            <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                              思考深度
                            </label>
                            <input
	                              type="range"
	                              min="0"
	                              max="3"
	                              step="1"
	                              value={(() => {
	                                const idx = ["minimal", "low", "medium", "high"].indexOf(thinkingLevel);
	                                return idx >= 0 ? idx : 3;
	                              })()}
	                              onChange={(e) => setThinkingLevel(["minimal", "low", "medium", "high"][Number(e.target.value)])}
                              className="w-full accent-zinc-900 h-1 bg-zinc-200 rounded-full"
                            />
                            <span className="text-xs text-right block mt-1 text-zinc-600">
	                              {{ minimal: "最小", low: "快速", medium: "平衡", high: "深度" }[thinkingLevel] || "深度"}
                            </span>
                          </div>
	                          <div>
	                            <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
	                              联网搜索
	                            </label>
	                            <button
	                              onClick={() => setWebSearch(!webSearch)}
	                              type="button"
	                              className={`px-3 py-1 rounded-lg border transition-colors text-sm flex items-center gap-1.5 ${
	                                webSearch
	                                  ? "bg-blue-600 text-white border-blue-600"
	                                  : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
	                              }`}
	                            >
	                              <Globe size={14} />
	                              {webSearch ? "开" : "关"}
	                            </button>
	                          </div>
                        </>
                      ) : null}

                      <div>
                        <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                          最大输出
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="6"
                          step="1"
                          value={[1024, 2048, 4096, 8192, 16384, 32768, 65536].indexOf(maxTokens)}
                          onChange={(e) => setMaxTokens([1024, 2048, 4096, 8192, 16384, 32768, 65536][e.target.value])}
                          className="w-full accent-zinc-900 h-1 bg-zinc-200 rounded-full"
                        />
                        <span className="text-xs text-right block mt-1 text-zinc-600">
                          {maxTokens >= 1024 ? `${Math.round(maxTokens / 1024)}K` : maxTokens}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {selectedImages.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {selectedImages.map((img) => (
                <div
                  key={img.id}
                  className="flex items-center gap-1.5 px-2 py-1 bg-zinc-100 rounded-lg border border-zinc-200"
                >
                  <span className="text-xs text-zinc-600 truncate max-w-[60px]">
                    {img.name}
                  </span>
                  <button
                    onClick={() => removeImage(img.id)}
                    className="text-zinc-400 hover:text-red-500"
                    type="button"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {selectedImages.length < 4 && (
                <span className="text-xs text-zinc-400">
                  {4 - selectedImages.length} 张可添加
                </span>
              )}
            </div>
          )}
        </div>

        <div className="relative flex items-center">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            accept="image/*"
            multiple
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={selectedImages.length >= 4}
            className={`absolute left-3 z-10 p-1.5 rounded-lg transition-colors ${
              selectedImages.length > 0
                ? "text-zinc-600 bg-zinc-200"
                : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            type="button"
          >
            <Paperclip size={16} />
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsMainInputFocused(true)}
            onBlur={() => setIsMainInputFocused(false)}
            placeholder="输入消息..."
            className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl pl-11 pr-12 py-3 text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 resize-none transition-colors"
            rows={1}
            style={{ minHeight: "48px" }}
          />

          <button
            onClick={isStreaming || isWaitingForAI ? onStop : handleSend}
            disabled={!isStreaming && !isWaitingForAI && !input.trim() && selectedImages.length === 0}
            className={`absolute right-2 bottom-2 p-2 rounded-lg text-white disabled:opacity-40 transition-colors ${
              isStreaming || isWaitingForAI ? "bg-red-600 hover:bg-red-500" : "bg-zinc-600 hover:bg-zinc-500"
            }`}
            type="button"
          >
            {isStreaming || isWaitingForAI ? <Square size={16} /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
