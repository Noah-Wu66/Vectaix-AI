"use client";
import { useEffect, useRef, useState } from "react";
import {
  Paperclip,
  Send,
  Square,
  X,
} from "lucide-react";
import { useToast } from "./ToastProvider";
import ModelSelector from "./ModelSelector";
import SettingsMenu from "./SettingsMenu";
import TokenCounter from "./TokenCounter";
import { COUNCIL_MAX_ROUNDS, countCompletedCouncilRounds, isCouncilModel } from "../lib/councilModel";

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
  const [selectedImages, setSelectedImages] = useState([]);
  const [isMainInputFocused, setIsMainInputFocused] = useState(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const mountedRef = useRef(true);
  const isCouncilSelected = isCouncilModel(model);
  const completedCouncilRounds = isCouncilSelected ? countCompletedCouncilRounds(messages) : 0;
  const councilRoundsRemaining = isCouncilSelected
    ? Math.max(0, COUNCIL_MAX_ROUNDS - completedCouncilRounds)
    : 0;
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

  const MAX_IMAGE_SIZE_MB = 20;
  const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
  const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

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
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const remainingSlots = 4 - selectedImages.length;
    const filesToAdd = files.slice(0, remainingSlots);

    const oversizedFiles = filesToAdd.filter((f) => f.size > MAX_IMAGE_SIZE_BYTES);
    const validFiles = filesToAdd.filter((f) => f.size <= MAX_IMAGE_SIZE_BYTES);

    if (oversizedFiles.length > 0) {
      const names = oversizedFiles.map((f) => f.name).join("、");
      toast.warning(`以下图片超过 ${MAX_IMAGE_SIZE_MB}MB 限制，已跳过：${names}`);
    }

    for (const file of validFiles) {
      let processedFile = file;
      if (!SUPPORTED_TYPES.includes(file.type)) {
        const converted = await convertToPng(file);
        if (!converted) continue;
        processedFile = converted;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        if (!mountedRef.current) return;
        setSelectedImages((prev) => {
          if (prev.length >= 4) return prev;
          return [
            ...prev,
            {
              file: processedFile,
              preview: ev.target.result,
              name: processedFile.name,
              id: `${Date.now()}-${Math.random()}`,
            },
          ];
        });
      };
      reader.readAsDataURL(processedFile);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (imageId) => {
    setSelectedImages((prev) => prev.filter((img) => img.id !== imageId));
  };

  const clearAllImages = () => {
    setSelectedImages([]);
  };

  useEffect(() => {
    if (model?.startsWith("deepseek-") && selectedImages.length > 0) {
      setSelectedImages([]);
    }
  }, [model, selectedImages.length]);

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
    if ((!text && selectedImages.length === 0) || loading) return;
    if (hasReachedCouncilRoundLimit) {
      toast.warning(`Council 最多支持 ${COUNCIL_MAX_ROUNDS} 轮对话，请新建对话继续。`);
      return;
    }
    onSend({ text, images: selectedImages });
    setInput("");
    clearAllImages();
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
              />
            </>
          )}

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
          {!model?.startsWith("deepseek-") && (
            <>
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
                disabled={hasReachedCouncilRoundLimit || selectedImages.length >= 4}
                className={`absolute left-3 z-10 p-1.5 rounded-lg transition-colors ${selectedImages.length > 0
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
            disabled={!isStreaming && !isWaitingForAI && (hasReachedCouncilRoundLimit || (!input.trim() && selectedImages.length === 0))}
            className={`absolute right-2 bottom-2 p-2 rounded-lg text-white disabled:opacity-40 transition-colors ${isStreaming || isWaitingForAI ? "bg-red-600 hover:bg-red-500" : "bg-zinc-600 hover:bg-zinc-500"
              }`}
            type="button"
          >
            {isStreaming || isWaitingForAI ? <Square size={16} /> : <Send size={16} />}
          </button>
        </div>

        {isCouncilSelected && (
          <div className="text-xs text-zinc-500 px-1">
            {hasReachedCouncilRoundLimit
              ? `Council 最多支持 ${COUNCIL_MAX_ROUNDS} 轮对话，当前已到上限；如需继续，请新建对话。`
              : `Council 会记住前面结论继续讨论；当前还可继续 ${councilRoundsRemaining} 轮；修改历史会从该轮起重开后续对话；如果要重新分析旧图片，请重新上传。`}
          </div>
        )}
      </div>
    </div>
  );
}
