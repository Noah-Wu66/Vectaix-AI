import { useState } from "react";
import { ExternalLink, Globe, X } from "lucide-react";
import { Gemini, Claude, OpenAI, Doubao } from "@lobehub/icons";

export function AIAvatar({ model, size = 24 }) {
  const squareProps = { size, shape: "square" };
  const props = { ...squareProps, style: { borderRadius: 6 } };
  if (model?.startsWith("volcengine/doubao-seed-")) {
    return <Doubao.Avatar {...props} />;
  }
  if (model?.startsWith("claude-")) {
    return <Claude.Avatar {...props} />;
  }
  if (model?.startsWith("gpt-")) {
    return <OpenAI.Avatar {...props} type="gpt5" />;
  }
  return <Gemini.Avatar {...props} />;
}

export function ResponsiveAIAvatar({ model, mobileSize = 22, desktopSize = 26 }) {
  return (
    <>
      <span className="sm:hidden"><AIAvatar model={model} size={mobileSize} /></span>
      <span className="hidden sm:inline"><AIAvatar model={model} size={desktopSize} /></span>
    </>
  );
}

export function normalizeCopiedText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function stripThinkingBlocks(text) {
  if (typeof text !== "string" || !text) return "";
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
}

export function buildCopyText(msg) {
  if (!msg) return "";
  const raw = typeof msg.content === "string" ? msg.content : "";
  const cleaned = msg.role === "model" ? stripThinkingBlocks(raw) : raw;
  return normalizeCopiedText(cleaned);
}

function stripMarkdown(text) {
  if (typeof text !== "string" || !text) return "";
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|```$/g, "").trim())
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[\*\-+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^[-*_]{3,}$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildPlainText(msg) {
  if (!msg) return "";
  const raw = typeof msg.content === "string" ? msg.content : "";
  const cleaned = msg.role === "model" ? stripThinkingBlocks(raw) : raw;
  return normalizeCopiedText(stripMarkdown(cleaned));
}

export function isSelectionFullyInsideElement(el) {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0) return false;
  const anchor = sel.anchorNode;
  const focus = sel.focusNode;
  if (!anchor || !focus) return false;
  return el.contains(anchor) && el.contains(focus);
}

export function Thumb({ src, className = "", onClick }) {
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

export function Citations({ citations }) {
  if (!citations || !Array.isArray(citations) || citations.length === 0) return null;

  const [open, setOpen] = useState(false);

  const uniqueCitations = [];
  const seenUrls = new Set();
  for (const c of citations) {
    if (c?.url && !seenUrls.has(c.url)) {
      seenUrls.add(c.url);
      uniqueCitations.push(c);
    }
  }

  if (uniqueCitations.length === 0) return null;

  const previewCount = Math.min(5, uniqueCitations.length);
  const previewItems = uniqueCitations.slice(0, previewCount);
  const getDomain = (url) => {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return url;
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-zinc-200">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-2.5 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-full text-xs transition-colors"
        title="查看全部来源"
      >
        <Globe size={12} className="text-zinc-500" />
        <span>信息来源</span>
        <span className="flex -space-x-1.5">
          {previewItems.map((citation, idx) => {
            const domain = getDomain(citation.url);
            const iconUrl = `https://${domain}/favicon.ico`;
            return (
              <img
                key={idx}
                src={iconUrl}
                alt=""
                className="w-4 h-4 rounded-full border border-white bg-white"
                loading="lazy"
                decoding="async"
              />
            );
          })}
        </span>
        {uniqueCitations.length > previewCount && (
          <span className="text-zinc-500">+{uniqueCitations.length - previewCount}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-xl border border-zinc-200 w-full max-w-md p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm text-zinc-700 font-medium">
                <Globe size={14} />
                信息来源
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
              <div className="flex flex-col gap-2">
                {uniqueCitations.map((citation, idx) => {
                  const domain = getDomain(citation.url);
                  const iconUrl = `https://${domain}/favicon.ico`;
                  return (
                    <a
                      key={idx}
                      href={citation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-2.5 py-2 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 rounded-lg text-sm text-zinc-700 transition-colors"
                      title={citation.title || citation.url}
                    >
                      <img
                        src={iconUrl}
                        alt=""
                        className="w-5 h-5 rounded-full border border-white bg-white flex-shrink-0"
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="truncate flex-1">
                        {citation.title || domain}
                      </span>
                      <ExternalLink size={14} className="text-zinc-400" />
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
