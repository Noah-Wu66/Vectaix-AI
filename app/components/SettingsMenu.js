"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Globe, Pencil, Settings2, Trash2, X } from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import PromptEditorModal from "./PromptEditorModal";
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  WEB_SEARCH_AUTH_INFO_LEVELS,
  WEB_SEARCH_INDUSTRIES,
  WEB_SEARCH_MAX_COUNT,
  WEB_SEARCH_PRESET_TIME_RANGES,
  buildCustomTimeRange,
  splitCustomTimeRange,
} from "@/lib/shared/webSearch";

const TIME_RANGE_LABELS = {
  "": "不限时间",
  OneDay: "最近一天",
  OneWeek: "最近一周",
  OneMonth: "最近一月",
  OneYear: "最近一年",
  custom: "自定义区间",
};

const INDUSTRY_LABELS = {
  "": "不限行业",
  finance: "finance（金融）",
  game: "game（游戏）",
};

export default function SettingsMenu({
  model,
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
  const [customTimeRangeOpen, setCustomTimeRangeOpen] = useState(false);
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const activePrompt = systemPrompts.find((prompt) => String(prompt?._id) === String(activePromptId));
  const activePromptName = activePrompt?.name || "无";
  const webSearchSettings = webSearch && typeof webSearch === "object"
    ? { ...DEFAULT_WEB_SEARCH_SETTINGS, ...webSearch }
    : DEFAULT_WEB_SEARCH_SETTINGS;
  const customTimeRange = splitCustomTimeRange(webSearchSettings.timeRange);

  const updateWebSearch = (patch) => {
    setWebSearch((prev) => ({
      ...(prev && typeof prev === "object" ? prev : DEFAULT_WEB_SEARCH_SETTINGS),
      ...patch,
    }));
  };

  useEffect(() => {
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
  }, [model, systemPrompts, activePromptId, activePromptIds, setActivePromptId, setActivePromptIds]);

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

  useEffect(() => {
    if (customTimeRange.startDate && customTimeRange.endDate) {
      setCustomTimeRangeOpen(true);
      setCustomStartDate(customTimeRange.startDate);
      setCustomEndDate(customTimeRange.endDate);
    }
  }, [customTimeRange.startDate, customTimeRange.endDate]);

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
      setCustomTimeRangeOpen(Boolean(customTimeRange.startDate && customTimeRange.endDate));
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
              className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-zinc-200 p-4 z-50 w-80 max-w-[calc(100vw-2rem)]"
            >
              <div className="flex justify-between items-center mb-3">
                <span className="font-medium text-zinc-900 text-sm">设置</span>
                <button
                  onClick={closeSettings}
                  className="text-zinc-400 hover:text-zinc-600"
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                    系统提示词
                  </label>
                  <div className="relative" ref={promptListRef}>
                    <button
                      onClick={() => setShowPromptList((value) => !value)}
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
                            <div
                              className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${activePromptId == null ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
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
                                className="flex-1 text-left text-sm text-zinc-700 truncate"
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
                                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isActive ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
                                >
                                  <button
                                    onClick={() => {
                                      const nextId = String(prompt?._id);
                                      setActivePromptId(nextId);
                                      setActivePromptIds?.((prev) => ({ ...prev, [model]: nextId }));
                                      setShowPromptList(false);
                                    }}
                                    className="flex-1 text-left text-sm text-zinc-700 truncate"
                                    type="button"
                                  >
                                    {prompt?.name}
                                  </button>
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => openEditPromptModal(prompt)}
                                      title="编辑提示词"
                                      className="p-1 text-zinc-500 hover:text-zinc-700"
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
                              <div className="px-2 py-2 text-xs text-zinc-400">暂无提示词，请先新建</div>
                            )}
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

                <div>
                  <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                    联网搜索
                  </label>
                  <div className="space-y-3">
                    <button
                      onClick={() => updateWebSearch({ enabled: !webSearchSettings.enabled })}
                      type="button"
                      className={`px-3 py-1 rounded-lg border transition-colors text-sm flex items-center gap-1.5 ${webSearchSettings.enabled
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                        }`}
                    >
                      <Globe size={14} />
                      {webSearchSettings.enabled ? "开" : "关"}
                    </button>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs text-zinc-500 mb-1 block">结果数量</label>
                        <input
                          type="number"
                          min={1}
                          max={WEB_SEARCH_MAX_COUNT}
                          value={webSearchSettings.count}
                          onChange={(event) => updateWebSearch({ count: event.target.value })}
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-zinc-500 mb-1 block">时间范围</label>
                        <select
                          value={customTimeRangeOpen ? "custom" : webSearchSettings.timeRange}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value === "custom") {
                              setCustomTimeRangeOpen(true);
                              setCustomStartDate(customTimeRange.startDate);
                              setCustomEndDate(customTimeRange.endDate);
                              if (!customTimeRange.startDate || !customTimeRange.endDate) {
                                updateWebSearch({ timeRange: "" });
                              }
                              return;
                            }
                            setCustomTimeRangeOpen(false);
                            setCustomStartDate("");
                            setCustomEndDate("");
                            updateWebSearch({ timeRange: value });
                          }}
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        >
                          {[...WEB_SEARCH_PRESET_TIME_RANGES, "custom"].map((value) => (
                            <option key={value || "empty"} value={value}>
                              {TIME_RANGE_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {customTimeRangeOpen ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="text-xs text-zinc-500 mb-1 block">开始日期</label>
                          <input
                            type="date"
                            value={customStartDate}
                            onChange={(event) => {
                              const startDate = event.target.value;
                              setCustomStartDate(startDate);
                              updateWebSearch({ timeRange: buildCustomTimeRange(startDate, customEndDate) });
                            }}
                            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-zinc-500 mb-1 block">结束日期</label>
                          <input
                            type="date"
                            value={customEndDate}
                            onChange={(event) => {
                              const endDate = event.target.value;
                              setCustomEndDate(endDate);
                              updateWebSearch({ timeRange: buildCustomTimeRange(customStartDate, endDate) });
                            }}
                            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700">
                        <span>返回正文</span>
                        <input
                          type="checkbox"
                          checked={webSearchSettings.needContent}
                          onChange={(event) => updateWebSearch({ needContent: event.target.checked })}
                        />
                      </label>
                      <label className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700">
                        <span>返回链接</span>
                        <input
                          type="checkbox"
                          checked={webSearchSettings.needUrl}
                          onChange={(event) => updateWebSearch({ needUrl: event.target.checked })}
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs text-zinc-500 mb-1 block">限定站点</label>
                        <input
                          type="text"
                          value={webSearchSettings.sites}
                          onChange={(event) => updateWebSearch({ sites: event.target.value })}
                          placeholder="aliyun.com|mp.qq.com"
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-zinc-500 mb-1 block">屏蔽站点</label>
                        <input
                          type="text"
                          value={webSearchSettings.blockHosts}
                          onChange={(event) => updateWebSearch({ blockHosts: event.target.value })}
                          placeholder="aliyun.com|mp.qq.com"
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs text-zinc-500 mb-1 block">权威等级</label>
                        <select
                          value={String(webSearchSettings.authInfoLevel)}
                          onChange={(event) => updateWebSearch({ authInfoLevel: Number(event.target.value) })}
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        >
                          {WEB_SEARCH_AUTH_INFO_LEVELS.map((value) => (
                            <option key={value} value={value}>
                              {value === 1 ? "仅非常权威" : "不限制"}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-zinc-500 mb-1 block">行业</label>
                        <select
                          value={webSearchSettings.industry}
                          onChange={(event) => updateWebSearch({ industry: event.target.value })}
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        >
                          {WEB_SEARCH_INDUSTRIES.map((value) => (
                            <option key={value || "empty"} value={value}>
                              {INDUSTRY_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <label className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700">
                      <span>改写检索词</span>
                      <input
                        type="checkbox"
                        checked={webSearchSettings.queryRewrite}
                        onChange={(event) => updateWebSearch({ queryRewrite: event.target.checked })}
                      />
                    </label>

                    <div className="text-[11px] leading-5 text-zinc-400">
                      web_summary 会固定开启总结；站点字段按 | 分隔，最多 5 个；自定义时间范围会自动生成文档要求的格式。
                    </div>
                  </div>
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
