"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BrainCircuit, ChevronDown, ChevronUp } from "lucide-react";
import Markdown from "./Markdown";

export default function ThinkingBlock({ thought, isStreaming, isSearching }) {
  const [collapsed, setCollapsed] = useState(true);
  const containerRef = useRef(null);

  // 联网搜索开始后或思考流结束后，自动折叠
  useEffect(() => {
    if (isSearching) {
      setCollapsed(true);
    } else {
      setCollapsed(!isStreaming);
    }
  }, [isStreaming, isSearching]);

  useEffect(() => {
    if (collapsed) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [thought, collapsed]);

  return (
    <div className="mb-2 w-full max-w-full">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="thinking-btn flex items-center gap-1.5 sm:gap-2.5 text-[11px] sm:text-xs font-medium text-zinc-500 hover:text-zinc-700 mb-1.5 uppercase tracking-wider bg-zinc-100 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg transition-colors"
      >
        <BrainCircuit size={14} className="sm:w-4 sm:h-4" />
        {isStreaming && !isSearching ? (
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
            className="thinking-content bg-zinc-50 border border-zinc-200 rounded-lg p-3 overflow-y-auto max-h-[200px] w-full text-xs text-zinc-400"
            ref={containerRef}
          >
            <Markdown enableHighlight={!isStreaming} className="prose-xs prose-pre:bg-zinc-800 prose-pre:text-zinc-100 prose-code:text-xs thinking-prose">
              {thought}
            </Markdown>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


