"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BrainCircuit, ChevronDown, ChevronUp, Compass, Globe } from "lucide-react";
import Markdown from "./Markdown";

export default function ThinkingBlock({ thought, isStreaming, isSearching, isDeciding, searchQuery }) {
  const [collapsed, setCollapsed] = useState(true);
  const containerRef = useRef(null);
  const safeThought = typeof thought === "string" ? thought : "";

  useEffect(() => {
    if (isSearching || isDeciding) {
      setCollapsed(true);
    } else {
      setCollapsed(!isStreaming);
    }
  }, [isStreaming, isSearching, isDeciding]);

  useEffect(() => {
    if (collapsed) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [thought, collapsed]);

  return (
    <div className="mb-2 w-full max-w-full">
      <button
        onClick={() => {
          if (isSearching || isDeciding) return;
          setCollapsed(!collapsed);
        }}
        disabled={isSearching || isDeciding}
        className="thinking-btn flex items-center gap-2 sm:gap-3 text-xs sm:text-sm font-medium mb-1.5 uppercase tracking-wider px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg transition-colors text-zinc-500 hover:text-zinc-700 bg-zinc-100"
      >
        {isSearching ? (
          <Globe size={16} className="sm:w-5 sm:h-5" />
        ) : isDeciding ? (
          <Compass size={16} className="sm:w-5 sm:h-5" />
        ) : (
          <BrainCircuit size={16} className="sm:w-5 sm:h-5" />
        )}
        {isSearching ? (
          <span className="flex items-center gap-1 min-w-0">
            <span className="truncate max-w-[220px]">
              {searchQuery ? `联网检索中：${searchQuery}` : "联网检索中"}
            </span>
            <span className="flex gap-0.5">
              <span className="w-1 h-1 bg-zinc-500 rounded-full animate-dot-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1 h-1 bg-zinc-500 rounded-full animate-dot-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1 h-1 bg-zinc-500 rounded-full animate-dot-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          </span>
        ) : isDeciding ? (
          <span className="flex items-center gap-1 sm:gap-1.5">
            自主决策中
            <span className="flex gap-0.5">
              <span
                className="w-1 h-1 bg-zinc-500 rounded-full animate-dot-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1 h-1 bg-zinc-500 rounded-full animate-dot-bounce"
                style={{ animationDelay: "100ms" }}
              />
              <span
                className="w-1 h-1 bg-zinc-500 rounded-full animate-dot-bounce"
                style={{ animationDelay: "200ms" }}
              />
            </span>
          </span>
        ) : isStreaming ? (
          <span className="flex items-center gap-1 sm:gap-1.5">
            思考中
            <span className="flex gap-0.5">
              <span
                className="w-1 h-1 bg-zinc-500 rounded-full animate-dot-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1 h-1 bg-zinc-500 rounded-full animate-dot-bounce"
                style={{ animationDelay: "100ms" }}
              />
              <span
                className="w-1 h-1 bg-zinc-500 rounded-full animate-dot-bounce"
                style={{ animationDelay: "200ms" }}
              />
            </span>
          </span>
        ) : (
          "思考过程"
        )}
        {collapsed ? (
          <ChevronDown size={12} className="sm:w-3.5 sm:h-3.5" />
        ) : (
          <ChevronUp size={12} className="sm:w-3.5 sm:h-3.5" />
        )}
      </button>

      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="thinking-content bg-zinc-50 border border-zinc-200 rounded-lg p-3 overflow-y-auto max-h-[200px] w-full max-w-[800px] text-xs text-zinc-400"
            ref={containerRef}
          >
            <Markdown enableHighlight={!isStreaming} className="prose-xs prose-pre:bg-zinc-800 prose-pre:text-zinc-100 prose-code:text-xs thinking-prose">
              {safeThought}
            </Markdown>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
