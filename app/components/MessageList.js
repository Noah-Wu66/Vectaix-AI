"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronDown,
  Copy,
  Download,
  Edit3,
  Paperclip,
  RotateCcw,
  Trash2,
  Type,
  User,
  X,
} from "lucide-react";
import Markdown from "./Markdown";
import ThinkingBlock from "./ThinkingBlock";
import ImageLightbox from "./ImageLightbox";
import ConfirmModal from "./ConfirmModal";
import { useToast } from "./ToastProvider";
import { exportMessageContent } from "@/lib/client/messageExport";
import { getMessageImageSrc, isKeepableImageSrc } from "@/lib/shared/messageImage";
import { getMessageFileAttachments } from "@/lib/shared/messageAttachments";
import {
  AttachmentCard,
  AIAvatar,
  ResponsiveAIAvatar,
  buildCopyText,
  buildPlainText,
  normalizeCopiedText,
  isSelectionFullyInsideElement,
  Thumb,
  Citations,
  LoadingSweepText,
} from "./MessageListHelpers";
import { AGENT_MODEL_ID, CHAT_MODELS, getModelConfig, isCouncilModel } from "@/lib/shared/models";

const AGENT_MIN_TOTAL_STEPS = 9;
const PENDING_RUN_TEXTS = new Set(["正在处理中...", "Council 正在处理中..."]);

function containsMarkdownTable(text) {
  if (typeof text !== "string") return false;
  const normalized = text.replace(/\r\n/g, "\n");
  return /\|.*\|[\t ]*\n[\t ]*\|?[\t ]*:?-{3,}:?[\t ]*(\|[\t ]*:?-{3,}:?[\t ]*)+\|?/u.test(normalized);
}

function isPendingRunText(text) {
  return typeof text === "string" && PENDING_RUN_TEXTS.has(text.trim());
}

const STARTER_PROMPTS = [
  { icon: "💡", title: "创意写作", description: "帮我写一个关于火星移民的科幻短篇开头" },
  { icon: "💻", title: "代码助手", description: "用 React 写一个带防抖功能的搜索框组件" },
  { icon: "🌍", title: "旅行规划", description: "制定一份去京都的 5 天文化深度游计划" },
  { icon: "📊", title: "数据分析", description: "如何通俗易懂地解释什么是‘量化宽松’？" },
];

export default function MessageList({
  messages,
  loading,
  chatEndRef,
  listRef,
  onScroll,
  editingMsgIndex,
  editingContent,
  editingImageAction,
  editingImage,
  fontSizeClass,
  model,
  modelReady = true,
  onEditingContentChange,
  onEditingImageSelect,
  onEditingImageRemove,
  onEditingImageKeep,
  onCancelEdit,
  onSubmitEdit,
  onCopy,
  onDeleteModelMessage,
  onDeleteUserMessage,
  onRegenerateModelMessage,
  onStartEdit,
  userAvatar,
  onSendStarterPrompt,
}) {
  const editTextareaRef = useRef(null);
  const editFileInputRef = useRef(null);
  const exportMenuRef = useRef(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, index: null, role: null });
  const [openExportMenuIndex, setOpenExportMenuIndex] = useState(null);
  const prevMessagesRef = useRef([]);
  const isCouncilConversation = isCouncilModel(model);
  const isAgentConversation = model === AGENT_MODEL_ID;
  const canEditImages = getModelConfig(model)?.supportsImages === true;
  const toast = useToast();
  const hasWaitingFirstChunk = messages.some((message) => message?.isWaitingFirstChunk);
  const hasStreamingContent = messages.some((message) => (message?.isStreaming && !message?.isWaitingFirstChunk) || message?.isSearching);
  const hasActiveConversationRun = messages.some((message) => message?.isStreaming === true);

  useEffect(() => {
    prevMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!exportMenuRef.current?.contains(event.target)) {
        setOpenExportMenuIndex(null);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpenExportMenuIndex(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    setOpenExportMenuIndex(null);
  }, [messages]);

  const isNewMessage = (msg, index) => {
    const prevMsgs = prevMessagesRef.current;
    return !prevMsgs[index] || prevMsgs[index].id !== msg.id;
  };

  const openLightbox = (src) => {
    if (!src) return;
    setLightboxSrc(src);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
    setLightboxSrc(null);
  };

  const handleDeleteClick = (index, role) => {
    setDeleteConfirm({ open: true, index, role });
  };

  const handleConfirmDelete = () => {
    if (deleteConfirm.index !== null) {
      if (deleteConfirm.role === "user") {
        onDeleteUserMessage(deleteConfirm.index);
      } else {
        onDeleteModelMessage(deleteConfirm.index);
      }
    }
    setDeleteConfirm({ open: false, index: null, role: null });
  };

  const handleEditFileSelect = (e) => {
    if (!canEditImages) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onEditingImageSelect?.({
        file,
        preview: ev.target?.result,
        name: file.name,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const hasEditingImage = () => {
    if (editingImageAction === "new") return Boolean(editingImage?.preview);
    if (editingImageAction === "keep") {
      const msg = messages?.[editingMsgIndex];
      return isKeepableImageSrc(getMessageImageSrc(msg));
    }
    return false;
  };

  const isEditingImageUploading = editingImageAction === "new" && editingImage?.uploadStatus === "uploading";

  const resizeEditTextarea = () => {
    const el = editTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 24)}px`;
  };

  const scrollEditIntoView = () => {
    const el = editTextareaRef.current;
    const container = listRef?.current;
    if (!el) return;
    // 优先只滚动消息列表容器，避免移动端键盘弹出时把整个页面滚飞
    if (container && typeof container.scrollTo === "function") {
      const elRect = el.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      const delta = elRect.top - (cRect.top + cRect.height / 2);
      container.scrollTo({ top: container.scrollTop + delta, behavior: "auto" });
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "auto" });
  };

  useEffect(() => {
    if (editingMsgIndex === null || editingMsgIndex === undefined) return;
    const el = editTextareaRef.current;
    resizeEditTextarea();
    // 用 preventScroll 阻止浏览器为 focus 自己滚动（移动端键盘弹出时最容易乱跳）
    if (el && typeof el.focus === "function") {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }
    // 首次对齐 + 等键盘/viewport 完成一次布局后再对齐一次
    requestAnimationFrame(scrollEditIntoView);
    const t = setTimeout(scrollEditIntoView, 80);
    return () => clearTimeout(t);
  }, [editingMsgIndex]);

  useEffect(() => {
    if (editingMsgIndex === null || editingMsgIndex === undefined) return;
    resizeEditTextarea();
  }, [editingContent, editingMsgIndex]);

  // 键盘弹出会触发 visualViewport resize；编辑中跟随一次，避免“必须按键才回正”
  useEffect(() => {
    if (editingMsgIndex === null || editingMsgIndex === undefined) return;
    const vv = window.visualViewport;
    if (!vv?.addEventListener) return;
    const onResize = () => requestAnimationFrame(scrollEditIntoView);
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [editingMsgIndex]);

  const handleBubbleCopy = (e) => {
    const el = e.currentTarget;
    if (!el) return;
    if (!isSelectionFullyInsideElement(el)) return;

    const selText = window.getSelection?.()?.toString?.();
    if (!selText) return;

    e.preventDefault();
    e.clipboardData?.setData("text/plain", normalizeCopiedText(selText));
  };

  const handleExportMessage = async (format, msg) => {
    const labelMap = {
      markdown: "Markdown",
      pdf: "PDF",
      docx: "Docx",
    };

    try {
      await exportMessageContent(format, buildCopyText(msg));
      toast.success(`已导出 ${labelMap[format] || "文件"}`);
    } catch (error) {
      toast.error(error?.message || "导出失败");
    } finally {
      setOpenExportMenuIndex(null);
    }
  };

  return (
    <div
      ref={listRef}
      onScroll={onScroll}
      className={`flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 py-4 space-y-4 scroll-smooth custom-scrollbar mobile-scroll ${fontSizeClass}`}
    >
      <ImageLightbox open={lightboxOpen} onClose={closeLightbox} src={lightboxSrc} />

      <ConfirmModal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, index: null, role: null })}
        onConfirm={handleConfirmDelete}
        title="删除消息"
        message={isCouncilConversation ? "确定要从这一轮开始删除吗？此操作会删除这一轮及其后所有轮次，无法撤销。" : `确定要删除这条${deleteConfirm.role === "user" ? "你的" : "AI"}消息吗？此操作无法撤销。`}
        confirmText="删除"
        danger
      />

      {messages.length === 0 ? (
        loading ? (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="flex items-center gap-1.5 px-6 py-4 glass-effect rounded-3xl shadow-sm">
              <LoadingSweepText text="..." ariaText="加载中" className="loading-sweep-dots text-xl" />
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center space-y-10 text-center px-4 max-w-4xl mx-auto w-full">
            <div className="space-y-6">
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 15 }}
                className="relative inline-block"
              >
                <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
                <AIAvatar model={model} size={72} animate={model === AGENT_MODEL_ID} className="relative z-10" />
              </motion.div>
              <div className="space-y-3 relative z-10">
                <h2 className="text-3xl font-bold bg-gradient-to-b from-zinc-800 to-zinc-500 dark:from-white dark:to-zinc-400 bg-clip-text text-transparent tracking-tight">
                  今天能帮您做点什么？
                </h2>
                <p className="text-zinc-400 dark:text-zinc-500 text-[15px] max-w-sm mx-auto leading-relaxed">
                  选择一个模型开始对话，或者尝试使用 Agent 模式处理复杂任务。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl px-4">
              {STARTER_PROMPTS.map((prompt, idx) => (
                <motion.button
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  onClick={() => onSendStarterPrompt?.(prompt.description)}
                  className="flex flex-col items-start p-4 rounded-2xl glass-effect border-zinc-200/40 hover:border-primary/30 hover:bg-primary/5 transition-all text-left group active:scale-[0.98]"
                >
                  <span className="text-xl mb-2 group-hover:scale-110 transition-transform">{prompt.icon}</span>
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-1">{prompt.title}</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500 line-clamp-1">{prompt.description}</span>
                </motion.button>
              ))}
            </div>
          </div>
        )
      ) : (
        messages.map((msg, i) => {
          // ... (保持逻辑部分不变)
          return (
            <motion.div
              key={msg.id}
              initial={isNewMessage(msg, i) ? { opacity: 0, y: 20 } : false}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col gap-3 ${msg.role === "user" ? "items-end" : "items-start"} max-w-4xl mx-auto w-full group`}
            >
              {msg.role === "model" && (msg.thought || hasVisibleContent || (msg.isStreaming && !msg.isWaitingFirstChunk) || hasParts || msg.isSearching || msg.searchError || hasThinkingTimeline || hasCouncilExpertStates || hasCouncilSummaryState) && (
                <div className="flex items-center gap-2 pl-1">
                  <AIAvatar model={model} size={24} animate={msg.isStreaming} />
                  <span className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider">
                    {CHAT_MODELS.find((m) => m.id === model)?.name}
                  </span>
                </div>
              )}

              <div className={`flex flex-col w-full ${msg.role === "user" ? "items-end" : "items-start"}`}>
                {/* Thinking Block */}
                {msg.role === "model" && (msg.thought || msg.isSearching || msg.searchError || hasThinkingTimeline || hasCouncilExpertStates || hasCouncilSummaryState) && (
                  <ThinkingBlock
                    thought={msg.thought}
                    isStreaming={msg.isThinkingStreaming}
                    isSearching={msg.isSearching}
                    searchQuery={msg.searchQuery}
                    searchError={msg.searchError}
                    timeline={msg.thinkingTimeline}
                    councilExpertStates={msg.councilExpertStates}
                    councilSummaryState={msg.councilSummaryState}
                    councilExperts={msg.councilExperts}
                    bodyText={hasBodyOutput ? "1" : ""}
                    showThoughtDetails={!isAgentConversation && !isCouncilConversation}
                    isAgentMode={isAgentConversation}
                  />
                )}

                {/* 消息正文气泡 */}
                {(hasParts || hasVisibleContent) && (
                  <div
                    className={`relative group/bubble px-4 py-3 sm:px-5 sm:py-4 transition-all duration-300 ${
                      msg.role === "user"
                        ? "msg-bubble-user max-w-[85%] md:max-w-[75%]"
                        : "msg-bubble-ai max-w-full md:max-w-[95%] w-full"
                    } ${msg.isStreaming ? "ai-glow ai-glow-active" : ""}`}
                    onCopy={handleBubbleCopy}
                  >
                    {/* (保持内容渲染逻辑不变) */}
                        {hasParts ? (
                          <div className="flex flex-col gap-2">
                            {(() => {
                              const entries = displayParts.map((part, idx) => ({ part, idx }));
                              const isUser = msg.role === "user";
                              const imageEntries = entries.filter(({ part }) => {
                                const url = part?.inlineData?.url;
                                return typeof url === "string" && url;
                              });
                              const fileEntries = entries.filter(({ part }) => {
                                return part?.fileData?.name && part?.fileData?.mimeType;
                              });
                              const textEntries = entries.filter(({ part }) => {
                                return part && typeof part.text === "string" && part.text.trim();
                              });
                              const ordered = isUser ? [...imageEntries, ...fileEntries, ...textEntries] : entries;

                              return ordered.map(({ part, idx }) => {
                                const url = part?.inlineData?.url;
                                if (typeof url === "string" && url) {
                                  return <Thumb key={idx} src={url} className="w-fit" onClick={openLightbox} />;
                                }
                                if (part?.fileData?.name) {
                                  return <AttachmentCard key={idx} file={part.fileData} compact={msg.role === "user"} />;
                                }
                                if (part && typeof part.text === "string" && part.text.trim()) {
                                  return isUser ? (
                                    <Markdown key={idx} enableHighlight={false} enableMath={false}>
                                      {part.text}
                                    </Markdown>
                                  ) : (
                                    <Markdown
                                      key={idx}
                                      enableHighlight={!msg.isStreaming}
                                      enableMath={true}
                                    >
                                      {part.text}
                                    </Markdown>
                                  );
                                }
                                return null;
                              });
                            })()}
                          </div>
                        ) : (
                          msg.role === "user" ? (
                            <Markdown enableHighlight={false} enableMath={false}>{msg.content}</Markdown>
                          ) : (
                            <Markdown enableHighlight={!msg.isStreaming} enableMath={true}>{msg.content}</Markdown>
                          )
                        )}

                        {msg.role === "model" && !msg.isStreaming && msg.citations && (
                          <Citations citations={msg.citations} />
                        )}
                      </div>
                    )}
                    {/* 消息操作按钮 */}
                    {!msg.isStreaming && (
                      <div
                        className={`flex flex-wrap gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0 ${msg.role === "user" ? "flex-row-reverse" : ""
                          }`}
                      >
                        {(hasParts || hasVisibleContent) && (
                          <button
                            onClick={() => onCopy(buildCopyText(msg))}
                            className="p-1.5 text-zinc-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                            title="复制"
                          >
                            <Copy size={14} />
                          </button>
                        )}

                        {msg.role === "model" && (hasParts || hasVisibleContent) && (
                          <button
                            onClick={() => onCopy(buildPlainText(msg))}
                            className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                            title="复制纯文本"
                          >
                            <Type size={14} />
                          </button>
                        )}

                        {msg.role === "user" ? (
                          <>
                            <button
                              onClick={() => handleDeleteClick(i, "user")}
                              className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-zinc-100 rounded-lg transition-colors"
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                            {!isAgentConversation ? (
                              <button
                                onClick={() => onStartEdit(i, msg)}
                                className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                                title="编辑并重新生成"
                              >
                                <Edit3 size={14} />
                              </button>
                            ) : null}
                          </>
                        ) : msg.role === "model" ? (
                          <>
                            <button
                              onClick={() => handleDeleteClick(i, "model")}
                              className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-zinc-100 rounded-lg transition-colors"
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                            {!isAgentConversation ? (
                              <button
                                onClick={() => onRegenerateModelMessage(i)}
                                disabled={loading || hasActiveConversationRun}
                                className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors disabled:opacity-50"
                                title="重新生成"
                              >
                                <RotateCcw size={14} />
                              </button>
                            ) : null}
                            {(hasParts || hasVisibleContent) && (
                              <div className="relative" ref={openExportMenuIndex === i ? exportMenuRef : null}>
                                <button
                                  type="button"
                                  onClick={() => setOpenExportMenuIndex((prev) => (prev === i ? null : i))}
                                  className={`inline-flex items-center gap-1 p-1.5 rounded-lg transition-colors ${openExportMenuIndex === i
                                    ? "text-zinc-700 bg-zinc-100"
                                    : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
                                    }`}
                                  title="导出"
                                >
                                  <Download size={14} />
                                  <ChevronDown size={12} className={`transition-transform ${openExportMenuIndex === i ? "rotate-180" : ""}`} />
                                </button>

                                {openExportMenuIndex === i && (
                                  <motion.div
                                    initial={{ opacity: 0, y: 6, scale: 0.96 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 6, scale: 0.96 }}
                                    className="absolute right-0 top-full z-20 mt-1 min-w-[150px] rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg sm:left-full sm:right-auto sm:top-1/2 sm:mt-0 sm:ml-2 sm:-translate-y-1/2"
                                  >
                                    {[
                                      { key: "markdown", label: "导出 Markdown" },
                                      { key: "pdf", label: "导出 PDF" },
                                      { key: "docx", label: "导出 Docx" },
                                    ].map((item) => (
                                      <button
                                        key={item.key}
                                        type="button"
                                        onClick={() => handleExportMessage(item.key, msg)}
                                        className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                                      >
                                        {item.label}
                                      </button>
                                    ))}
                                  </motion.div>
                                )}
                              </div>
                            )}
                          </>
                        ) : null}
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          );
        })
      )}

      {/* 只在有消息且加载中且没有正在流式输出或搜索的消息时显示加载指示器 */}
      {messages.length > 0 && (loading || hasWaitingFirstChunk) && !hasStreamingContent && (
        <div className="flex gap-2 sm:gap-3 items-start">
          <ResponsiveAIAvatar
            model={model}
            mobileSize={22}
            desktopSize={28}
            animate={isCouncilModel(model) || model === AGENT_MODEL_ID}
          />
          <div className="flex min-w-[4.75rem] items-center justify-center px-3 sm:px-4 py-2.5 sm:py-3 bg-zinc-100 rounded-2xl">
            <LoadingSweepText
              text="..."
              ariaText={hasWaitingFirstChunk ? "等待响应" : "加载中"}
              className="loading-sweep-dots text-lg sm:text-xl"
            />
          </div>
        </div>
      )}

      <div ref={chatEndRef} />
    </div>
  );
}
