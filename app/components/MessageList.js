"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Copy,
  Edit3,
  ExternalLink,
  Globe,
  Paperclip,
  RotateCcw,
  Sparkles,
  Trash2,
  Type,
  User,
  X,
} from "lucide-react";
import { Gemini, Claude, OpenAI } from "@lobehub/icons";
import Markdown from "./Markdown";
import ThinkingBlock from "./ThinkingBlock";
import ImageLightbox from "./ImageLightbox";
import ConfirmModal from "./ConfirmModal";

function AIAvatar({ model, size = 24 }) {
  const props = { size, shape: "square", style: { borderRadius: 6 } };
  if (model?.startsWith("claude-")) {
    return <Claude.Avatar {...props} />;
  }
  if (model?.startsWith("gpt-")) {
    return <OpenAI.Avatar {...props} type="gpt5" />;
  }
  return <Gemini.Avatar {...props} />;
}

// 响应式 AI 头像：移动端和桌面端分别渲染不同大小
function ResponsiveAIAvatar({ model, mobileSize = 22, desktopSize = 26 }) {
  return (
    <>
      <span className="sm:hidden"><AIAvatar model={model} size={mobileSize} /></span>
      <span className="hidden sm:inline"><AIAvatar model={model} size={desktopSize} /></span>
    </>
  );
}

function normalizeCopiedText(text) {
  return (text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")
    // 把浏览器从块级元素/段落转换出来的“超多空行”压缩到最多 1 个空行
    .replace(/\n{3,}/g, "\n\n");
}

function stripThinkingBlocks(text) {
  if (typeof text !== "string" || !text) return "";
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
}

function buildCopyText(msg) {
  if (!msg) return "";
  const raw = typeof msg.content === "string" ? msg.content : "";
  const cleaned = msg.role === "model" ? stripThinkingBlocks(raw) : raw;
  return normalizeCopiedText(cleaned);
}

function stripMarkdown(text) {
  if (typeof text !== "string" || !text) return "";
  return text
    // 移除代码块
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|```$/g, "").trim())
    // 移除行内代码
    .replace(/`([^`]+)`/g, "$1")
    // 移除标题标记
    .replace(/^#{1,6}\s+/gm, "")
    // 移除粗体
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    // 移除斜体
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // 移除删除线
    .replace(/~~([^~]+)~~/g, "$1")
    // 移除链接，保留文字
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // 移除图片
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // 移除引用
    .replace(/^>\s?/gm, "")
    // 移除无序列表标记
    .replace(/^[\*\-+]\s+/gm, "")
    // 移除有序列表标记
    .replace(/^\d+\.\s+/gm, "")
    // 移除水平线
    .replace(/^[-*_]{3,}$/gm, "")
    // 清理多余空行
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildPlainText(msg) {
  if (!msg) return "";
  const raw = typeof msg.content === "string" ? msg.content : "";
  const cleaned = msg.role === "model" ? stripThinkingBlocks(raw) : raw;
  return normalizeCopiedText(stripMarkdown(cleaned));
}

function isSelectionFullyInsideElement(el) {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0) return false;
  const anchor = sel.anchorNode;
  const focus = sel.focusNode;
  if (!anchor || !focus) return false;
  return el.contains(anchor) && el.contains(focus);
}

function Thumb({ src, className = "", onClick }) {
  if (!src) return null;
  return (
    <button
      type="button"
      onClick={() => onClick?.(src)}
      className={`block text-left ${className}`}
      title="点击查看"
    >
      <img
        src={src}
        alt=""
        className="block max-w-[240px] max-h-[180px] w-auto h-auto object-cover rounded-lg border border-zinc-200 bg-zinc-50"
        loading="eager"
        decoding="async"
      />
    </button>
  );
}

function SearchingIndicator() {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2.5 text-[11px] sm:text-xs font-medium text-blue-600 mb-1.5 uppercase tracking-wider bg-blue-50 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg">
      <Globe size={14} className="sm:w-4 sm:h-4 animate-pulse" />
      <span className="flex items-center gap-1 sm:gap-1.5">
        正在搜索网络
        <span className="flex gap-0.5">
          <span className="w-1 h-1 bg-blue-400 rounded-full animate-dot-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1 h-1 bg-blue-400 rounded-full animate-dot-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-1 h-1 bg-blue-400 rounded-full animate-dot-bounce" style={{ animationDelay: "300ms" }} />
        </span>
      </span>
    </div>
  );
}

function Citations({ citations }) {
  if (!citations || !Array.isArray(citations) || citations.length === 0) return null;

  // 去重并限制显示数量
  const uniqueCitations = [];
  const seenUrls = new Set();
  for (const c of citations) {
    if (c?.url && !seenUrls.has(c.url)) {
      seenUrls.add(c.url);
      uniqueCitations.push(c);
    }
  }

  if (uniqueCitations.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-zinc-200">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
        <Globe size={12} />
        <span>信息来源</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {uniqueCitations.slice(0, 5).map((citation, idx) => {
          const domain = (() => {
            try {
              return new URL(citation.url).hostname.replace('www.', '');
            } catch {
              return citation.url;
            }
          })();
          return (
            <a
              key={idx}
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-lg text-xs transition-colors max-w-[200px]"
              title={citation.title || citation.url}
            >
              <ExternalLink size={10} className="flex-shrink-0" />
              <span className="truncate">{citation.title || domain}</span>
            </a>
          );
        })}
        {uniqueCitations.length > 5 && (
          <span className="px-2 py-1 text-xs text-zinc-400">
            +{uniqueCitations.length - 5} 更多来源
          </span>
        )}
      </div>
    </div>
  );
}

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
}) {
  const editTextareaRef = useRef(null);
  const editFileInputRef = useRef(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, index: null, role: null });

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

  const getMessageImageSrc = (msg) => {
    if (msg && typeof msg.image === "string" && msg.image) return msg.image;
    if (Array.isArray(msg?.parts)) {
      for (const p of msg.parts) {
        const url = p?.inlineData?.url;
        if (typeof url === "string" && url) return url;
      }
    }
    return null;
  };

  const isHttpUrl = (src) => typeof src === "string" && /^https?:\/\//i.test(src);
  const isDataImageUrl = (src) => typeof src === "string" && /^data:image\//i.test(src);
  const isKeepableImageSrc = (src) => isHttpUrl(src) || isDataImageUrl(src);

  const handleEditFileSelect = (e) => {
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

    const selText = window.getSelection?.()?.toString?.() ?? "";
    if (!selText) return;

    e.preventDefault();
    e.clipboardData?.setData("text/plain", normalizeCopiedText(selText));
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
        message={`确定要删除这条${deleteConfirm.role === "user" ? "你的" : "AI"}消息吗？此操作无法撤销。`}
        confirmText="删除"
        danger
      />

      {messages.length === 0 ? (
        loading ? (
          // 加载历史会话时的居中加载动画
          <div className="h-full flex flex-col items-center justify-center">
            <div className="flex items-center gap-1.5 px-4 py-3 bg-zinc-100 rounded-2xl">
              <span
                className="loading-dot w-2 h-2 bg-zinc-400 rounded-full animate-dot-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="loading-dot w-2 h-2 bg-zinc-400 rounded-full animate-dot-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="loading-dot w-2 h-2 bg-zinc-400 rounded-full animate-dot-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </div>
            <p className="mt-3 text-sm text-zinc-400">加载中...</p>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400">
            <Sparkles size={40} className="mb-4 text-zinc-300" />
            <p className="font-medium">开始新对话</p>
          </div>
        )
      ) : (
        messages.map((msg, i) => {
          const hasParts = Array.isArray(msg.parts) && msg.parts.length > 0;
          // 跳过等待首个内容且没有任何可显示内容的 model 消息（但搜索中的消息不跳过）
          if (msg.role === "model" && msg.isWaitingFirstChunk && !msg.thought && !msg.content && !hasParts && !msg.isSearching) {
            return null;
          }
          return (
            <motion.div
              key={msg.id ?? i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col gap-1.5 ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              {msg.role === "user" && (
                <div className="flex items-center gap-1.5 flex-row-reverse">
                  <div className="w-8 h-8 rounded-md flex items-center justify-center bg-zinc-100 text-zinc-600 overflow-hidden">
                    {userAvatar ? (
                      <img src={userAvatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User size={16} />
                    )}
                  </div>
                  <span className="text-xs text-zinc-400 font-medium">你</span>
                </div>
              )}
              {msg.role === "model" && (msg.thought || msg.content || (msg.isStreaming && !msg.isWaitingFirstChunk) || hasParts) && (
                <div className="flex items-center gap-1.5">
                  <AIAvatar model={model} size={28} />
                  <span className="text-xs text-zinc-400 font-medium">AI</span>
                </div>
              )}

              <div
                className={`flex flex-col ${msg.role === "user"
                  ? "items-end w-full max-w-[92%]"
                  : "items-start w-full"
                  }`}
              >
                {msg.role === "model" && msg.thought && (
                  <ThinkingBlock thought={msg.thought} isStreaming={msg.isThinkingStreaming} isSearching={msg.isSearching} />
                )}

                {msg.role === "model" && msg.isSearching && (
                  <SearchingIndicator />
                )}

                {/* 编辑模式 */}
                {editingMsgIndex === i && msg.role === "user" ? (
                  <div className="w-full space-y-2">
                    <input
                      type="file"
                      ref={editFileInputRef}
                      onChange={handleEditFileSelect}
                      className="hidden"
                      accept="image/*"
                    />

                    {(() => {
                      const existing = getMessageImageSrc(msg);
                      const showSrc =
                        editingImageAction === "new"
                          ? editingImage?.preview
                          : editingImageAction === "keep"
                            ? existing
                            : null;
                      return showSrc ? (
                        <div className="w-fit">
                          <Thumb src={showSrc} onClick={openLightbox} />
                        </div>
                      ) : null;
                    })()}

                    <textarea
                      ref={editTextareaRef}
                      value={editingContent}
                      onChange={(e) => onEditingContentChange(e.target.value)}
                      onFocus={scrollEditIntoView}
                      onKeyDown={(e) => {
                        // 桌面端：Enter 发送，Shift+Enter 换行
                        // 移动端：不拦截 Enter，避免 iOS 输入法换行按钮误触发送
                        if (e.key === "Enter" && !e.shiftKey) {
                          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                          if (!isMobile) {
                            e.preventDefault();
                            if (!loading && (editingContent.trim() || hasEditingImage())) {
                              onSubmitEdit(i);
                            }
                          }
                        }
                      }}
                      className="w-full bg-white border border-zinc-300 rounded-xl px-4 py-3 text-sm text-zinc-800 focus:outline-none focus:border-zinc-400 resize-none min-h-[80px]"
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => editFileInputRef.current?.click()}
                        className="px-3 py-1.5 text-xs text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors inline-flex items-center gap-1"
                        title="添加/更换图片"
                      >
                        <Paperclip size={14} />
                        图片
                      </button>

                      {(() => {
                        const existing = getMessageImageSrc(msg);
                        const hasExisting = isKeepableImageSrc(existing);
                        const hasNew = editingImageAction === "new" && Boolean(editingImage?.preview);
                        const showToggle =
                          editingImageAction === "remove" ? hasExisting : hasExisting || hasNew;
                        if (!showToggle) return null;

                        const label = editingImageAction === "remove" ? "恢复图片" : "移除图片";
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              if (editingImageAction === "remove") {
                                if (hasExisting) onEditingImageKeep?.();
                              } else {
                                onEditingImageRemove?.();
                              }
                              if (editFileInputRef.current) editFileInputRef.current.value = "";
                            }}
                            className="px-3 py-1.5 text-xs text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors inline-flex items-center gap-1"
                            title={label}
                          >
                            <X size={14} />
                            {label}
                          </button>
                        );
                      })()}

                      <button
                        onClick={onCancelEdit}
                        className="px-3 py-1.5 text-xs text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => onSubmitEdit(i)}
                        disabled={loading || (!editingContent.trim() && !hasEditingImage())}
                        className="px-3 py-1.5 text-xs text-white bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 rounded-lg transition-colors"
                      >
                        提交并重新生成
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {(hasParts || msg.content || msg.image) && (
                      <div
                        className={`msg-bubble px-4 py-3 rounded-2xl ${msg.role === "user"
                          ? "bg-white border border-zinc-200 text-zinc-800 max-h-[45vh] overflow-y-auto mobile-scroll custom-scrollbar"
                          : "bg-zinc-100 text-zinc-800"
                          }`}
                        onCopy={handleBubbleCopy}
                      >
                        {hasParts ? (
                          <div className="flex flex-col gap-2">
                            {(() => {
                              const entries = msg.parts.map((part, idx) => ({ part, idx }));
                              const isUser = msg.role === "user";
                              const imageEntries = entries.filter(({ part }) => {
                                const url = part?.inlineData?.url;
                                return typeof url === "string" && url;
                              });
                              const textEntries = entries.filter(({ part }) => {
                                return part && typeof part.text === "string" && part.text.trim();
                              });
                              const ordered = isUser ? [...imageEntries, ...textEntries] : entries;

                              return ordered.map(({ part, idx }) => {
                                const url = part?.inlineData?.url;
                                if (typeof url === "string" && url) {
                                  return <Thumb key={idx} src={url} className="w-fit" onClick={openLightbox} />;
                                }
                                if (part && typeof part.text === "string" && part.text.trim()) {
                                  return isUser ? (
                                    <span key={idx} className="whitespace-pre-wrap break-words">{part.text}</span>
                                  ) : (
                                    <Markdown key={idx} enableHighlight={!msg.isStreaming}>
                                      {part.text}
                                    </Markdown>
                                  );
                                }
                                return null;
                              });
                            })()}
                          </div>
                        ) : (
                          <>
                            {msg.image && (
                              <div className="mb-2 w-fit">
                                <Thumb src={msg.image} onClick={openLightbox} />
                              </div>
                            )}

                            {msg.role === "user" ? (
                              <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                            ) : (
                              <Markdown enableHighlight={!msg.isStreaming}>{msg.content}</Markdown>
                            )}
                          </>
                        )}

                        {msg.role === "model" && !msg.isStreaming && msg.citations && (
                          <Citations citations={msg.citations} />
                        )}
                      </div>
                    )}

                    {/* 消息操作按钮 */}
                    {!msg.isStreaming && (
                      <div
                        className={`flex gap-1 mt-1 ${msg.role === "user" ? "flex-row-reverse" : ""
                          }`}
                      >
                        <button
                          onClick={() => onCopy(buildCopyText(msg))}
                          className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                          title="复制"
                        >
                          <Copy size={14} />
                        </button>

                        {msg.role === "model" && (
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
                            <button
                              onClick={() => onStartEdit(i, msg)}
                              className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                              title="编辑并重新生成"
                            >
                              <Edit3 size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleDeleteClick(i, "model")}
                              className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-zinc-100 rounded-lg transition-colors"
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                            <button
                              onClick={() => onRegenerateModelMessage(i)}
                              disabled={loading}
                              className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors disabled:opacity-50"
                              title="重新生成"
                            >
                              <RotateCcw size={14} />
                            </button>
                          </>
                        )}
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
      {messages.length > 0 && (loading || messages.some((m) => m.isWaitingFirstChunk)) && !messages.some((m) => (m.isStreaming && !m.isWaitingFirstChunk) || m.isSearching) && (
        <div className="flex gap-2 sm:gap-3 items-start">
          <ResponsiveAIAvatar model={model} mobileSize={22} desktopSize={28} />
          <div className="flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-2.5 sm:py-3 bg-zinc-100 rounded-2xl">
            <span
              className="loading-dot w-1.5 h-1.5 sm:w-2 sm:h-2 bg-zinc-400 rounded-full animate-dot-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="loading-dot w-1.5 h-1.5 sm:w-2 sm:h-2 bg-zinc-400 rounded-full animate-dot-bounce"
              style={{ animationDelay: "150ms" }}
            />
            <span
              className="loading-dot w-1.5 h-1.5 sm:w-2 sm:h-2 bg-zinc-400 rounded-full animate-dot-bounce"
              style={{ animationDelay: "300ms" }}
            />
          </div>
        </div>
      )}

      <div ref={chatEndRef} />
    </div>
  );
}


