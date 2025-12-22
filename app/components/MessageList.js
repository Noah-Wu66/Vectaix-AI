"use client";

import { motion } from "framer-motion";
import {
  Bot,
  Copy,
  Edit3,
  RotateCcw,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import Markdown from "./Markdown";
import ThinkingBlock from "./ThinkingBlock";

export default function MessageList({
  messages,
  loading,
  chatEndRef,
  editingMsgIndex,
  editingContent,
  onEditingContentChange,
  onCancelEdit,
  onSubmitEdit,
  onCopy,
  onDeleteModelMessage,
  onDeleteUserMessage,
  onRegenerateModelMessage,
  onStartEdit,
}) {
  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-4 scroll-smooth custom-scrollbar mobile-scroll">
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-zinc-400">
          <Sparkles size={40} className="mb-4 text-zinc-300" />
          <p className="font-medium">开始新对话</p>
        </div>
      ) : (
        messages.map((msg, i) => (
          <motion.div
            key={msg.id ?? i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex flex-col gap-1.5 ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            {msg.role === "user" && (
              <div className="flex items-center gap-1.5 flex-row-reverse">
                <div className="w-6 h-6 rounded-md flex items-center justify-center bg-zinc-100 text-zinc-600">
                  <User size={12} />
                </div>
                <span className="text-xs text-zinc-400 font-medium">你</span>
              </div>
            )}
            {msg.role === "model" && (msg.thought || msg.content || msg.isStreaming) && (
              <div className="flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-md flex items-center justify-center bg-zinc-100 text-zinc-600">
                  <Bot size={12} />
                </div>
                <span className="text-xs text-zinc-400 font-medium">AI</span>
              </div>
            )}

            <div
              className={`flex flex-col ${msg.role === "user"
                ? "items-end max-w-[80%]"
                : "items-start w-full"
                }`}
            >
              {msg.role === "model" && msg.thought && (
                <ThinkingBlock thought={msg.thought} isStreaming={msg.isThinkingStreaming} />
              )}

              {/* 编辑模式 */}
              {editingMsgIndex === i && msg.role === "user" ? (
                <div className="w-full space-y-2">
                  <textarea
                    value={editingContent}
                    onChange={(e) => onEditingContentChange(e.target.value)}
                    className="w-full bg-white border border-zinc-300 rounded-xl px-4 py-3 text-sm text-zinc-800 focus:outline-none focus:border-zinc-400 resize-none min-h-[80px]"
                    autoFocus
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={onCancelEdit}
                      className="px-3 py-1.5 text-xs text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => onSubmitEdit(i)}
                      disabled={loading || !editingContent.trim()}
                      className="px-3 py-1.5 text-xs text-white bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 rounded-lg transition-colors"
                    >
                      提交并重新生成
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className={`px-4 py-3 rounded-2xl ${msg.role === "user"
                      ? "bg-white border border-zinc-200 text-zinc-800"
                      : "bg-zinc-100 text-zinc-800"
                      }`}
                  >
                    {msg.image && (
                      <img
                        src={msg.image}
                        className="mb-2 max-h-48 rounded-lg"
                        alt=""
                      />
                    )}

                    {msg.type === "image" ? (
                      <img
                        src={`data:${msg.mimeType};base64,${msg.content}`}
                        className="max-w-full h-auto rounded-lg"
                        alt=""
                      />
                    ) : (
                      <Markdown>{msg.content}</Markdown>
                    )}
                  </div>

                  {/* 消息操作按钮 */}
                  {!msg.isStreaming && (
                    <div
                      className={`flex gap-1 mt-1 ${msg.role === "user" ? "flex-row-reverse" : ""
                        }`}
                    >
                      <button
                        onClick={() => onCopy(msg.content)}
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                        title="复制"
                      >
                        <Copy size={14} />
                      </button>

                      {msg.role === "user" ? (
                        <>
                          <button
                            onClick={() => onDeleteUserMessage(i)}
                            className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-zinc-100 rounded-lg transition-colors"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                          <button
                            onClick={() => onStartEdit(i, msg.content)}
                            className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                            title="编辑并重新生成"
                          >
                            <Edit3 size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => onDeleteModelMessage(i)}
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
        ))
      )}

      {/* 只在加载中且没有正在流式输出的消息时显示加载指示器 */}
      {loading && !messages.some((m) => m.isStreaming) && (
        <div className="flex gap-2 sm:gap-3 items-start">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0 bg-zinc-100 text-zinc-600">
            <Bot size={14} />
          </div>
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


