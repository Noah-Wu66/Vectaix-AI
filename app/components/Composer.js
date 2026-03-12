"use client";
import { useEffect, useRef, useState } from "react";
import {
  FileText,
  Paperclip,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useToast } from "./ToastProvider";
import ModelSelector from "./ModelSelector";
import SettingsMenu from "./SettingsMenu";
import TokenCounter from "./TokenCounter";
import {
  AGENT_MODEL_ID,
  COUNCIL_MAX_ROUNDS,
  countCompletedCouncilRounds,
  getModelConfig,
  isCouncilModel,
} from "@/lib/shared/models";
import { ATTACHMENT_ACCEPT, getAttachmentLimits, IMAGE_MIME_TYPES } from "@/lib/shared/attachments";
import { createLocalAttachment, isImageAttachment } from "@/lib/shared/messageAttachments";

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result || null);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Composer({
  loading,
  isStreaming,
  isWaitingForAI,
  model,
  onModelChange,
  messages,
  contextWindow,
  historyLimit,
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
  prefill,
}) {
  const toast = useToast();
  const [input, setInput] = useState("");
  const [selectedAttachments, setSelectedAttachments] = useState([]);
  const [agentHintVisible, setAgentHintVisible] = useState(false);
  const [isMainInputFocused, setIsMainInputFocused] = useState(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const mountedRef = useRef(true);
  const modelConfig = getModelConfig(model);
  const supportsDocuments = modelConfig?.supportsDocuments === true;
  const isCouncilSelected = isCouncilModel(model);
  const completedCouncilRounds = isCouncilSelected ? countCompletedCouncilRounds(messages) : 0;
  const hasReachedCouncilRoundLimit = isCouncilSelected && completedCouncilRounds >= COUNCIL_MAX_ROUNDS;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const setAppHeight = () => {
      const vv = window.visualViewport;
      if (isMainInputFocused) {
        document.documentElement.style.setProperty("--app-height", `${Math.round(vv?.height)}px`);
        document.documentElement.style.setProperty("--app-offset-top", `${Math.round(vv?.offsetTop)}px`);
      } else {
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
    el.style.height = "auto";
    const sh = el.scrollHeight;
    el.style.height = `${Math.min(sh, 160)}px`;
    el.style.overflowY = sh > 160 ? "auto" : "hidden";
  }, [input, model]);

  useEffect(() => {
    if (!prefill || typeof prefill.text !== "string") return;
    setInput(prefill.text);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.style.height = "auto";
      const sh = el.scrollHeight;
      el.style.height = `${Math.min(sh, 160)}px`;
      el.style.overflowY = sh > 160 ? "auto" : "hidden";
    }
  }, [prefill?.nonce]);

  useEffect(() => {
    if (model?.startsWith("deepseek-") && selectedAttachments.length > 0) {
      setSelectedAttachments([]);
      setAgentHintVisible(false);
    }
  }, [model, selectedAttachments.length]);

  useEffect(() => {
    if (supportsDocuments) {
      setAgentHintVisible(false);
      return;
    }
    const next = selectedAttachments.filter((item) => isImageAttachment(item));
    if (next.length !== selectedAttachments.length) {
      setSelectedAttachments(next);
      setAgentHintVisible(true);
    }
  }, [supportsDocuments, selectedAttachments]);

  const convertToPng = (file) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const baseName = file.name.replace(/\.[^.]+$/, "");
              const newFile = new File([blob], `${baseName}.png`, { type: "image/png" });
              resolve(newFile);
            } else {
              resolve(null);
            }
          },
          "image/png",
          1.0
        );
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    });
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const remainingSlots = 4 - selectedAttachments.length;
    const filesToAdd = files.slice(0, remainingSlots);
    const nextAttachments = [];
    const blockedDocuments = [];
    const invalidFiles = [];
    const oversizedFiles = [];

    for (const file of filesToAdd) {
      const local = createLocalAttachment({ file });
      if (!local.category) {
        invalidFiles.push(file.name);
        continue;
      }

      const limits = getAttachmentLimits(local.category);
      if (limits?.maxBytes && file.size > limits.maxBytes) {
        oversizedFiles.push(file.name);
        continue;
      }

      if (!supportsDocuments && !isImageAttachment(local)) {
        blockedDocuments.push(file.name);
        continue;
      }

      if (isImageAttachment(local)) {
        let processedFile = file;
        if (!IMAGE_MIME_TYPES.includes(file.type)) {
          const converted = await convertToPng(file);
          if (!converted) {
            invalidFiles.push(file.name);
            continue;
          }
          processedFile = converted;
        }
        const preview = await readAsDataUrl(processedFile).catch(() => null);
        nextAttachments.push(createLocalAttachment({ file: processedFile, preview }));
      } else {
        nextAttachments.push(local);
      }
    }

    if (oversizedFiles.length > 0) {
      toast.warning(`以下文件超过大小限制，已跳过：${oversizedFiles.join("、")}`);
    }
    if (invalidFiles.length > 0) {
      toast.warning(`以下文件类型不支持或读取失败，已跳过：${invalidFiles.join("、")}`);
    }
    if (blockedDocuments.length > 0) {
      setAgentHintVisible(true);
      toast.warning("这类文件目前仅 Agent 支持");
    }

    if (nextAttachments.length > 0 && mountedRef.current) {
      setSelectedAttachments((prev) => [...prev, ...nextAttachments].slice(0, 4));
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (attachmentId) => {
    setSelectedAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  };

  const clearAllAttachments = () => {
    setSelectedAttachments([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (!isMobile) {
        e.preventDefault();
        if (!loading) handleSend();
      }
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if ((!text && selectedAttachments.length === 0) || loading) return;
    if (hasReachedCouncilRoundLimit) {
      toast.warning(`Council 最多支持 ${COUNCIL_MAX_ROUNDS} 轮对话，请新建对话继续。`);
      return;
    }
    onSend({ text, attachments: selectedAttachments });
    setInput("");
    clearAllAttachments();
    setAgentHintVisible(false);
  };

  const handleSwitchToAgent = () => {
    setAgentHintVisible(false);
    onModelChange(AGENT_MODEL_ID);
  };

  return (
    <div className="p-3 md:p-4 bg-white border-t border-zinc-200 z-20 shrink-0 pb-safe">
      <div className="max-w-3xl mx-auto space-y-2">
        <div className="flex items-center gap-2">
          <ModelSelector model={model} onModelChange={onModelChange} />
          {!isCouncilSelected && (
            <>
              <SettingsMenu
                model={model}
                webSearch={webSearch}
                setWebSearch={setWebSearch}
                systemPrompts={systemPrompts}
                activePromptIds={activePromptIds}
                setActivePromptIds={setActivePromptIds}
                activePromptId={activePromptId}
                setActivePromptId={setActivePromptId}
                onAddPrompt={onAddPrompt}
                onDeletePrompt={onDeletePrompt}
                onUpdatePrompt={onUpdatePrompt}
              />
              <TokenCounter
                messages={messages}
                systemPrompts={systemPrompts}
                activePromptId={activePromptId}
                historyLimit={historyLimit}
                contextWindow={contextWindow}
                model={model}
                webSearch={webSearch}
              />
            </>
          )}

          {selectedAttachments.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {selectedAttachments.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-1.5 px-2 py-1 bg-zinc-100 rounded-lg border border-zinc-200 max-w-[180px]"
                >
                  {isImageAttachment(item) ? (
                    <span className="w-5 h-5 rounded bg-zinc-200 overflow-hidden shrink-0">
                      {item.preview ? <img src={item.preview} alt="" className="w-full h-full object-cover" /> : null}
                    </span>
                  ) : (
                    <FileText size={14} className="text-zinc-500 shrink-0" />
                  )}
                  <span className="text-xs text-zinc-600 truncate">
                    {item.name}
                  </span>
                  <button
                    onClick={() => removeAttachment(item.id)}
                    className="text-zinc-400 hover:text-red-500 shrink-0"
                    type="button"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {selectedAttachments.length < 4 && (
                <span className="text-xs text-zinc-400">
                  {4 - selectedAttachments.length} 个可添加
                </span>
              )}
            </div>
          )}
        </div>

        {agentHintVisible && (
          <div className="flex items-center justify-between gap-3 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles size={14} className="shrink-0" />
              <span className="truncate">这类文件目前仅 Agent 支持，切换后再继续上传。</span>
            </div>
            <button
              type="button"
              onClick={handleSwitchToAgent}
              className="shrink-0 rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
            >
              切换到 Agent
            </button>
          </div>
        )}

        <div className="relative flex items-center">
          {!model?.startsWith("deepseek-") && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="hidden"
                accept={ATTACHMENT_ACCEPT}
                multiple
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={hasReachedCouncilRoundLimit || selectedAttachments.length >= 4}
                className={`absolute left-3 z-10 p-1.5 rounded-lg transition-colors ${selectedAttachments.length > 0
                  ? "text-zinc-600 bg-zinc-200"
                  : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                type="button"
              >
                <Paperclip size={16} />
              </button>
            </>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsMainInputFocused(true)}
            onBlur={() => setIsMainInputFocused(false)}
            readOnly={hasReachedCouncilRoundLimit}
            placeholder={hasReachedCouncilRoundLimit ? `已达到 ${COUNCIL_MAX_ROUNDS} 轮上限，请新建对话...` : "输入消息..."}
            className={`flex-1 bg-zinc-50 border border-zinc-200 rounded-xl ${model?.startsWith("deepseek-") ? "pl-4" : "pl-11"} pr-12 py-3 text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 resize-none transition-colors`}
            rows={1}
            style={{ minHeight: "48px" }}
          />

          <button
            onClick={isStreaming || isWaitingForAI ? onStop : handleSend}
            disabled={!isStreaming && !isWaitingForAI && (hasReachedCouncilRoundLimit || (!input.trim() && selectedAttachments.length === 0))}
            className={`absolute right-2 bottom-2 p-2 rounded-lg text-white disabled:opacity-40 transition-colors ${isStreaming || isWaitingForAI ? "bg-red-600 hover:bg-red-500" : "bg-zinc-600 hover:bg-zinc-500"
              }`}
            type="button"
          >
            {isStreaming || isWaitingForAI ? <Square size={16} /> : <Send size={16} />}
          </button>
        </div>

        {isCouncilSelected && hasReachedCouncilRoundLimit && (
          <div className="text-xs text-zinc-500 px-1">
            {`Council 最多支持 ${COUNCIL_MAX_ROUNDS} 轮对话，当前已到上限；如需继续，请新建对话。`}
          </div>
        )}
      </div>
    </div>
  );
}
