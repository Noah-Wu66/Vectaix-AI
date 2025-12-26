"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronUp,
  Pencil,
  Paperclip,
  Plus,
  Send,
  Square,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { CHAT_MODELS } from "./ChatModels";
export default function Composer({
  loading,
  isStreaming,
  model,
  onModelChange,
  thinkingLevel,
  setThinkingLevel,
  historyLimit,
  setHistoryLimit,
  aspectRatio,
  setAspectRatio,
  imageSize,
  setImageSize,
  systemPrompts,
  activePromptIds,
  setActivePromptIds,
  activePromptId,
  setActivePromptId,
  saveSettings,
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
  const [selectedImage, setSelectedImage] = useState(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const currentModel = CHAT_MODELS.find((m) => m.id === model);
  // 移动端键盘弹出时，同步可视高度，避免键盘遮挡输入区（尤其是 iOS Safari）
  useEffect(() => {
    const setAppHeight = () => {
      const vv = window.visualViewport;
      document.documentElement.style.setProperty("--app-height", `${Math.round(vv?.height || window.innerHeight)}px`);
      document.documentElement.style.setProperty("--app-offset-top", `${Math.round(vv?.offsetTop || 0)}px`);
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
  }, []);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto"; const sh = el.scrollHeight; el.style.height = `${Math.min(sh, 160)}px`; el.style.overflowY = sh > 160 ? "auto" : "hidden";
  }, [input, model]);
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setSelectedImage({
        file,
        preview: ev.target.result,
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setSelectedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
    if ((!text && !selectedImage) || loading) return;
    onSend({ text, image: selectedImage });
    setInput("");
    removeImage();
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
              {currentModel ? (
                <currentModel.Icon size={14} />
              ) : (
                <Sparkles size={14} />
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
                    {CHAT_MODELS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          onModelChange(m.id);
                          setShowModelMenu(false);
                        }}
                        className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2.5 transition-colors ${
                          model === m.id
                            ? "bg-zinc-600 text-white"
                            : "text-zinc-600 hover:bg-zinc-50"
                        }`}
                        type="button"
                      >
                        <m.Icon
                          size={16}
                          className={model === m.id ? "" : m.color}
                        />
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
                              saveSettings({
                                activeSystemPromptId: nextId,
                                activeSystemPromptIds: { [model]: nextId },
                              });
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
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setHistoryLimit(next);
                            saveSettings({ historyLimit: next });
                          }}
                          className="w-full accent-zinc-900 h-1 bg-zinc-200 rounded-full"
                        />
                        <span className="text-xs text-right block mt-1 text-zinc-600">
                          {historyLimit || "无限制"} 条
                        </span>
                      </div>

                      {/* Model-specific settings */}
                      {model === "gemini-3-pro-image-preview" ? (
                        <div>
                          <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                            宽高比
                          </label>
                          <select
                            value={aspectRatio}
                            onChange={(e) => {
                              setAspectRatio(e.target.value);
                              saveSettings({ aspectRatio: e.target.value });
                            }}
                            className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-700"
                          >
                            <option value="1:1">1:1</option>
                            <option value="2:3">2:3</option>
                            <option value="3:2">3:2</option>
                            <option value="9:16">9:16</option>
                            <option value="16:9">16:9</option>
                            <option value="21:9">21:9</option>
                            <option value="4:3">4:3</option>
                            <option value="3:4">3:4</option>
                            <option value="4:5">4:5</option>
                            <option value="5:4">5:4</option>
                          </select>
                          <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mt-3 mb-2 block">
                            分辨率
                          </label>
                          <select
                            value={imageSize || "2K"}
                            onChange={(e) => {
                              setImageSize(e.target.value);
                              saveSettings({ imageSize: e.target.value });
                            }}
                            className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-700"
                          >
                            <option value="1K">1K</option>
                            <option value="2K">2K</option>
                            <option value="4K">4K</option>
                          </select>
                        </div>
                      ) : model === "gemini-3-flash-preview" ? (
                        <div>
                          <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                            思考深度
                          </label>
                          <select
                            value={thinkingLevel}
                            onChange={(e) => {
                              setThinkingLevel(e.target.value);
                              saveSettings({ thinkingLevels: { [model]: e.target.value } });
                            }}
                            className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-700"
                          >
                            <option value="high">深度 (High)</option>
                            <option value="medium">平衡 (Medium)</option>
                            <option value="low">快速 (Low)</option>
                            <option value="minimal">最小 (Minimal)</option>
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                            思考深度
                          </label>
                          <select
                            value={thinkingLevel}
                            onChange={(e) => {
                              setThinkingLevel(e.target.value);
                              saveSettings({ thinkingLevels: { [model]: e.target.value } });
                            }}
                            className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-700"
                          >
                            <option value="high">深度 (High)</option>
                            <option value="low">快速 (Low)</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {selectedImage && (
            <div className="flex items-center gap-2 px-2 py-1 bg-zinc-100 rounded-lg border border-zinc-200">
              <span className="text-xs text-zinc-600 truncate max-w-[80px]">
                {selectedImage.name}
              </span>
              <button
                onClick={removeImage}
                className="text-zinc-400 hover:text-red-500"
                type="button"
              >
                <X size={12} />
              </button>
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
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className={`absolute left-3 z-10 p-1.5 rounded-lg transition-colors ${
              selectedImage
                ? "text-zinc-600 bg-zinc-200"
                : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200"
            }`}
            type="button"
          >
            <Paperclip size={16} />
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl pl-11 pr-12 py-3 text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 resize-none transition-colors"
            rows={1}
            style={{ minHeight: "48px" }}
          />

          <button
            onClick={isStreaming ? onStop : handleSend}
            disabled={!isStreaming && (loading || (!input.trim() && !selectedImage))}
            className={`absolute right-2 bottom-2 p-2 rounded-lg text-white disabled:opacity-40 transition-colors ${
              isStreaming ? "bg-red-600 hover:bg-red-500" : "bg-zinc-600 hover:bg-zinc-500"
            }`}
            type="button"
          >
            {isStreaming ? <Square size={16} /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
