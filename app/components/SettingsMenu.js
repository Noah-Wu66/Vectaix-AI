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
  normalizeAgentDriverModelId,
} from "@/lib/shared/models";
import {
  buildCustomTimeRange,
  DEFAULT_WEB_SEARCH_SETTINGS,
  splitCustomTimeRange,
  WEB_SEARCH_INDUSTRIES,
  WEB_SEARCH_MAX_COUNT,
  WEB_SEARCH_PRESET_TIME_RANGES,
} from "@/lib/shared/webSearch";

const MODEL_GROUP_TITLES = {
  gemini: "Google",
  claude: "Anthropic",
  openai: "OpenAI",
  seed: "ByteDance",
  deepseek: "DeepSeek",
};

const AGENT_MODEL_OPTIONS = getAgentDriverModels();
const CUSTOM_TIME_RANGE_VALUE = "__custom__";
const WEB_SEARCH_TIME_RANGE_LABELS = {
  "": "不限制",
  OneDay: "最近一天",
  OneWeek: "最近一周",
  OneMonth: "最近一月",
  OneYear: "最近一年",
};
const WEB_SEARCH_AUTHORITY_OPTIONS = [
  { value: 0, label: "不限制" },
  { value: 1, label: "仅非常权威" },
];
const WEB_SEARCH_INDUSTRY_LABELS = {
  "": "默认",
  finance: "金融",
  game: "游戏",
};

export default function SettingsMenu({
  model,
  agentModel,
  setAgentModel,
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
  const [timeRangeMode, setTimeRangeMode] = useState("");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const confirmActionRef = useRef(null);
  const promptListRef = useRef(null);

  const activePrompt = systemPrompts.find((prompt) => String(prompt?._id) === String(activePromptId));
  const activePromptName = activePrompt?.name || "无";
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

  const updateWebSearchCount = (rawValue) => {
    const parsed = Number.parseInt(rawValue, 10);
    updateWebSearch({
      count: Number.isFinite(parsed) && parsed > 0
        ? Math.min(parsed, WEB_SEARCH_MAX_COUNT)
        : DEFAULT_WEB_SEARCH_SETTINGS.count,
    });
  };

  const handleTimeRangeModeChange = (nextValue) => {
    setTimeRangeMode(nextValue);
    if (nextValue === CUSTOM_TIME_RANGE_VALUE) {
      updateWebSearch({ timeRange: buildCustomTimeRange(customStartDate, customEndDate) });
      return;
    }
    updateWebSearch({ timeRange: nextValue });
  };

  const handleCustomTimeRangeChange = (field, value) => {
    const nextStartDate = field === "startDate" ? value : customStartDate;
    const nextEndDate = field === "endDate" ? value : customEndDate;
    if (field === "startDate") {
      setCustomStartDate(value);
    } else {
      setCustomEndDate(value);
    }
    updateWebSearch({ timeRange: buildCustomTimeRange(nextStartDate, nextEndDate) });
  };

  const isCustomTimeRange = timeRangeMode === CUSTOM_TIME_RANGE_VALUE;

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
    if (!showSettings) return;
    const { startDate, endDate } = splitCustomTimeRange(webSearchSettings.timeRange);
    if (startDate && endDate) {
      setTimeRangeMode(CUSTOM_TIME_RANGE_VALUE);
      setCustomStartDate(startDate);
      setCustomEndDate(endDate);
      return;
    }
    setTimeRangeMode(webSearchSettings.timeRange || "");
    setCustomStartDate("");
    setCustomEndDate("");
  }, [showSettings]);

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
              className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-zinc-200 p-4 z-50 w-[min(92vw,420px)] max-w-[calc(100vw-2rem)] max-h-[72vh] overflow-y-auto"
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
                {model === AGENT_MODEL_ID && (
                  <div>
                    <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                      Agent 模型
                    </label>
                    <select
                      value={normalizedAgentModel}
                      onChange={(event) => setAgentModel?.(event.target.value)}
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-blue-500"
                    >
                      {agentModelGroups.map((group) => (
                        <optgroup key={group.groupKey} label={group.title}>
                          {group.models.map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                )}

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

                {supportsWebSearch && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">
                        联网搜索
                      </label>
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
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-zinc-500 mb-1.5 block">返回条数</label>
                        <input
                          type="number"
                          min={1}
                          max={WEB_SEARCH_MAX_COUNT}
                          value={webSearchSettings.count}
                          onChange={(event) => updateWebSearchCount(event.target.value)}
                          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-zinc-500 mb-1.5 block">权威范围</label>
                        <select
                          value={String(webSearchSettings.authInfoLevel)}
                          onChange={(event) => updateWebSearch({ authInfoLevel: Number(event.target.value) })}
                          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-blue-500"
                        >
                          {WEB_SEARCH_AUTHORITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-zinc-500 mb-1.5 block">时间范围</label>
                      <select
                        value={timeRangeMode}
                        onChange={(event) => handleTimeRangeModeChange(event.target.value)}
                        className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-blue-500"
                      >
                        {WEB_SEARCH_PRESET_TIME_RANGES.map((value) => (
                          <option key={value || "default"} value={value}>{WEB_SEARCH_TIME_RANGE_LABELS[value]}</option>
                        ))}
                        <option value={CUSTOM_TIME_RANGE_VALUE}>自定义区间</option>
                      </select>
                    </div>

                    {isCustomTimeRange && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-zinc-500 mb-1.5 block">开始日期</label>
                          <input
                            type="date"
                            value={customStartDate}
                            onChange={(event) => handleCustomTimeRangeChange("startDate", event.target.value)}
                            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-zinc-500 mb-1.5 block">结束日期</label>
                          <input
                            type="date"
                            value={customEndDate}
                            onChange={(event) => handleCustomTimeRangeChange("endDate", event.target.value)}
                            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-blue-500"
                          />
                        </div>
                        <div className="col-span-2 text-[11px] text-zinc-400">
                          会自动保存成 YYYY-MM-DD..YYYY-MM-DD。
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 text-sm text-zinc-700">
                      <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={webSearchSettings.needContent}
                          onChange={(event) => updateWebSearch({ needContent: event.target.checked })}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        带正文
                      </label>
                      <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={webSearchSettings.needUrl}
                          onChange={(event) => updateWebSearch({ needUrl: event.target.checked })}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        带链接
                      </label>
                      <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={webSearchSettings.queryRewrite}
                          onChange={(event) => updateWebSearch({ queryRewrite: event.target.checked })}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        改写搜索词
                      </label>
                      <div>
                        <label className="text-xs text-zinc-500 mb-1.5 block">行业模式</label>
                        <select
                          value={webSearchSettings.industry}
                          onChange={(event) => updateWebSearch({ industry: event.target.value })}
                          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-blue-500"
                        >
                          {WEB_SEARCH_INDUSTRIES.map((value) => (
                            <option key={value || "default"} value={value}>{WEB_SEARCH_INDUSTRY_LABELS[value]}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-zinc-500 mb-1.5 block">指定站点</label>
                      <input
                        type="text"
                        value={webSearchSettings.sites}
                        onChange={(event) => updateWebSearch({ sites: event.target.value })}
                        placeholder="例如：openai.com|platform.openai.com"
                        className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-zinc-500 mb-1.5 block">屏蔽站点</label>
                      <input
                        type="text"
                        value={webSearchSettings.blockHosts}
                        onChange={(event) => updateWebSearch({ blockHosts: event.target.value })}
                        placeholder="例如：example.com|foo.bar"
                        className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-blue-500"
                      />
                      <div className="mt-1 text-[11px] text-zinc-400">
                        多个域名用 | 分隔，最多 5 个。
                      </div>
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
