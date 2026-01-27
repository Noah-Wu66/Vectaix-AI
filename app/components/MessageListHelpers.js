import { ExternalLink, Globe } from "lucide-react";
import { Gemini, Claude, OpenAI } from "@lobehub/icons";

export function AIAvatar({ model, size = 24 }) {
  const props = { size, shape: "square", style: { borderRadius: 6 } };
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
  return (text ?? "")
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
