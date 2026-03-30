"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Globe, Plus, Settings2, X } from "lucide-react";
import { CHAT_RUNTIME_MODE_CHAT, getModelConfig } from "@/lib/shared/models";
import { DEFAULT_WEB_SEARCH_SETTINGS } from "@/lib/shared/webSearch";
import ModelSelector from "./ModelSelector";
import { useToast } from "./ToastProvider";
import PromptEditorModal from "./PromptEditorModal";

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
  const [chatSystemPromptDraft, setChatSystemPromptDraft] = useState("");
  const [systemPromptSaving, setSystemPromptSaving] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("add");
  const [editorPromptId, setEditorPromptId] = useState(null);
  const [editorName, setEditorName] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [editorSaving, setEditorSaving] = useState(false);
  const modelConfig = getModelConfig(model);
  const supportsWebSearch = modelConfig?.supportsWebSearch === true;
  const isChatMode = chatMode === CHAT_RUNTIME_MODE_CHAT;
  const webSearchSettings = webSearch && typeof webSearch === "object"
    ? { ...DEFAULT_WEB_SEARCH_SETTINGS, ...webSearch }
    : DEFAULT_WEB_SEARCH_SETTINGS;
  const savedChatSystemPrompt = typeof chatSystemPrompt === "string" ? chatSystemPrompt : "";
  const hasChatSystemPromptChanges = chatSystemPromptDraft !== savedChatSystemPrompt;

  useEffect(() => {
    if (!showSettings) return;
    setChatSystemPromptDraft(savedChatSystemPrompt);
  }, [showSettings, savedChatSystemPrompt]);

  const updateWebSearch = (patch) => {
    setWebSearch((prev) => ({
      ...(prev && typeof prev === "object" ? prev : DEFAULT_WEB_SEARCH_SETTINGS),
      ...patch,
    }));
  };

  const saveChatSystemPrompt = async () => {
    if (!hasChatSystemPromptChanges || !onChatSystemPromptSave) return;
    setSystemPromptSaving(true);
    try {
      const settings = await onChatSystemPromptSave(chatSystemPromptDraft);
      if (!settings) return;
      toast.success(chatSystemPromptDraft.trim() ? "Chat 系统提示词已保存" : "Chat 系统提示词已清空");
    } finally {
      setSystemPromptSaving(false);
    }
  };

  const openAddPrompt = () => {
    setEditorMode("add");
    setEditorName("");
    setEditorContent(chatSystemPromptDraft);
    setEditorOpen(true);
  };

  const openEditPrompt = (prompt) => {
    setEditorMode("edit");
    setEditorPromptId(prompt._id);
    setEditorName(prompt.name);
    setEditorContent(prompt.content);
    setEditorOpen(true);
  };

  const handleSavePrompt = async () => {
    if (!editorName.trim() || !editorContent.trim()) {
      toast.warning("名称和内容不能为空");
      return;
    }
    setEditorSaving(true);
    try {
      if (editorMode === "add") {
        await addSystemPrompt(editorName, editorContent);
        toast.success("已保存预设");
      } else {
        await updateSystemPrompt(editorPromptId, editorName, editorContent);
        toast.success("已更新预设");
      }
      setEditorOpen(false);
    } catch (e) {
      toast.error(e?.message || "保存失败");
    } finally {
      setEditorSaving(false);
    }
  };

  const handleDeletePrompt = async (id) => {
    if (!window.confirm("确定删除这个预设吗？")) return;
    try {
      await deleteSystemPrompt(id);
      toast.success("已删除");
    } catch (e) {
      toast.error("删除失败");
    }
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
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider block">
                        系统提示词
                      </label>
                      <button
                        type="button"
                        onClick={openAddPrompt}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                      >
                        <Plus size={12} /> 存为预设
                      </button>
                    </div>

                    {systemPrompts && systemPrompts.length > 0 && (
                      <div className="mb-2 flex items-center gap-1">
                        <select
                          className="flex-1 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1.5 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none"
                          value=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) return;
                            const prompt = systemPrompts.find(p => p._id === val);
                            if (prompt) {
                              setChatSystemPromptDraft(prompt.content);
                              toast.success("已加载预设内容");
                            }
                            e.target.value = "";
                          }}
                        >
                          <option value="" disabled>选择预设填充...</option>
                          {systemPrompts.map(p => (
                            <option key={p._id} value={p._id}>{p.name}</option>
                          ))}
                        </select>
                        <select
                          className="w-16 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1.5 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none"
                          value=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) return;
                            const [action, id] = val.split(":");
                            const prompt = systemPrompts.find(p => p._id === id);
                            if (!prompt) return;
                            if (action === "edit") openEditPrompt(prompt);
                            if (action === "delete") handleDeletePrompt(id);
                            e.target.value = "";
                          }}
                        >
                          <option value="" disabled>管理</option>
                          {systemPrompts.map(p => (
                            <optgroup key={p._id} label={p.name}>
                              <option value={`edit:${p._id}`}>编辑</option>
                              <option value={`delete:${p._id}`}>删除</option>
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    )}

                    <textarea
                      value={chatSystemPromptDraft}
                      onChange={(e) => setChatSystemPromptDraft(e.target.value)}
                      placeholder="默认无。这里写的内容会追加到 Chat 模式系统提示词最后。"
                      rows={6}
                      className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm text-zinc-800 dark:text-zinc-200 resize-none focus:outline-none focus:border-zinc-400"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-xs text-zinc-500 leading-5">
                        留空就是不追加，只对 Chat 模式生效。
                      </p>
                      <button
                        type="button"
                        onClick={saveChatSystemPrompt}
                        disabled={systemPromptSaving || !hasChatSystemPromptChanges}
                        className="shrink-0 bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 text-white font-medium px-3 py-2 rounded-lg text-sm transition-colors"
                      >
                        {systemPromptSaving ? "保存中..." : "保存"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <PromptEditorModal
        open={editorOpen}
        title={editorMode === "add" ? "保存为预设" : "编辑预设"}
        name={editorName}
        content={editorContent}
        onNameChange={setEditorName}
        onContentChange={setEditorContent}
        onClose={() => setEditorOpen(false)}
        onSave={handleSavePrompt}
        saving={editorSaving}
      />
    </div>
  );
}
