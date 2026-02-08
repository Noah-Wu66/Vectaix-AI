"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BrainCircuit, ChevronDown, ChevronUp, FileText, Globe } from "lucide-react";
import Markdown from "./Markdown";

function normalizeTimeline(timeline) {
  if (!Array.isArray(timeline)) return [];
  return timeline
    .filter((step) => step && typeof step === "object")
    .map((step) => ({
      id: step.id,
      kind: step.kind,
      status: step.status,
      content: typeof step.content === "string" ? step.content : "",
      query: typeof step.query === "string" ? step.query : "",
      title: typeof step.title === "string" ? step.title : "",
      url: typeof step.url === "string" ? step.url : "",
      message: typeof step.message === "string" ? step.message : "",
      excerpt: typeof step.excerpt === "string" ? step.excerpt : "",
      resultCount: Number.isFinite(step.resultCount) ? step.resultCount : null,
      synthetic: step.synthetic === true,
    }))
    .filter((step) => step.kind === "thought" || step.kind === "search" || step.kind === "reader");
}

function LoadingDots() {
  return (
    <span className="flex gap-0.5">
      <span className="w-1 h-1 bg-zinc-500 rounded-full animate-dot-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1 h-1 bg-zinc-500 rounded-full animate-dot-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1 h-1 bg-zinc-500 rounded-full animate-dot-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

export default function ThinkingBlock({ thought, isStreaming, isSearching, searchQuery, searchError, timeline }) {
  const [collapsed, setCollapsed] = useState(true);
  const [expandedTimelineId, setExpandedTimelineId] = useState(null);
  const containerRef = useRef(null);
  const safeThought = typeof thought === "string" ? thought : "";
  const safeSearchError = typeof searchError === "string" ? searchError : "";
  const timelineItems = normalizeTimeline(timeline);
  const hasTimeline = timelineItems.length > 0;
  const activeReaderStep = [...timelineItems].reverse().find((step) => step.kind === "reader" && step.status === "running");

  useEffect(() => {
    setCollapsed(!(isStreaming || isSearching));
  }, [isStreaming, isSearching]);

  useEffect(() => {
    if (collapsed) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [thought, timeline, collapsed]);

  useEffect(() => {
    if (!hasTimeline) {
      setExpandedTimelineId(null);
      return;
    }
    const last = timelineItems[timelineItems.length - 1];
    setExpandedTimelineId(last?.id || null);
  }, [hasTimeline, timelineItems]);

  useEffect(() => {
    if (!hasTimeline) return;
    if (!isStreaming) {
      setExpandedTimelineId(null);
    }
  }, [hasTimeline, isStreaming]);

  const headerText = (() => {
    if (isSearching) {
      if (activeReaderStep) {
        const target = activeReaderStep.title || activeReaderStep.url;
        return target ? `查看网页中：${target}` : "查看网页中";
      }
      return searchQuery ? `联网处理中：${searchQuery}` : "联网处理中";
    }
    if (isStreaming) return "思考中";
    return "思考过程";
  })();

  const renderTimelineStep = (step, idx) => {
    const isExpanded = expandedTimelineId === step.id;
    const isRunning = step.status === "running";
    const isError = step.status === "error";

    const getTitle = () => {
      if (step.kind === "thought") return "思考过程";
      if (step.kind === "search") return isRunning ? "联网搜索中" : (isError ? "联网搜索失败" : "联网搜索完成");
      if (step.kind === "reader") return isRunning ? "查看网页中" : (isError ? "网页读取失败" : "网页正文已读取");
      return "处理中";
    };

    const hasDetail = (() => {
      if (step.kind === "thought") return Boolean(step.content);
      if (step.kind === "search") return Boolean(step.query || Number.isFinite(step.resultCount) || (isError && step.message));
      if (step.kind === "reader") return Boolean((step.title || step.url || step.excerpt) || (isError && step.message));
      return false;
    })();

    const titleText = getTitle();

    const icon = step.kind === "reader"
      ? <FileText size={16} className="sm:w-5 sm:h-5" />
      : step.kind === "search"
        ? <Globe size={16} className="sm:w-5 sm:h-5" />
        : <BrainCircuit size={16} className="sm:w-5 sm:h-5" />;

    const capsuleClass = `thinking-btn inline-flex w-fit max-w-full items-center gap-2 sm:gap-3 text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg transition-colors ${isError ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-500"}`;

    if (step.kind === "thought") {
      const isSynthetic = step.synthetic === true;
      return (
        <div key={step.id || `thought-${idx}`} className="w-full max-w-[800px]">
          <button
            type="button"
            onClick={() => {
              if (!hasDetail) return;
              setExpandedTimelineId((prev) => (prev === step.id ? null : step.id));
            }}
            className={`${capsuleClass} ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
          >
            {icon}
            <span>{isSynthetic ? "思考中" : titleText}</span>
            {isRunning ? <LoadingDots /> : null}
            {hasDetail ? (isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null}
          </button>
          {hasDetail && isExpanded ? (
            <div className="thinking-content mt-1.5 bg-zinc-100 border border-zinc-200 rounded-2xl p-3 overflow-y-auto max-h-[200px] w-full max-w-[800px] text-xs text-zinc-400" ref={containerRef}>
              <Markdown enableHighlight={step.status !== "streaming"} className="prose-xs prose-pre:bg-zinc-800 prose-pre:text-zinc-100 prose-code:text-xs thinking-prose">
                {step.content}
              </Markdown>
            </div>
          ) : null}
        </div>
      );
    }

    if (step.kind === "search") {
      return (
        <div key={step.id || `search-${idx}`} className="w-full max-w-[800px]">
          <div className={capsuleClass}>
            {icon}
            <span>{titleText}</span>
            {isRunning ? <LoadingDots /> : null}
          </div>
        </div>
      );
    }

    if (step.kind === "reader") {
      return (
        <div key={step.id || `reader-${idx}`} className="w-full max-w-[800px]">
          <div className={capsuleClass}>
            {icon}
            <span>{titleText}</span>
            {isRunning ? <LoadingDots /> : null}
          </div>
        </div>
      );
    }

    return null;
  };

  if (hasTimeline) {
    return (
      <div className="mb-2 w-full max-w-[800px] flex flex-col gap-2">
        {timelineItems.map((step, idx) => renderTimelineStep(step, idx))}
      </div>
    );
  }

  return (
    <div className="mb-2 w-full max-w-full">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="thinking-btn flex items-center gap-2 sm:gap-3 text-xs sm:text-sm font-medium mb-1.5 uppercase tracking-wider px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg transition-colors text-zinc-500 hover:text-zinc-700 bg-zinc-100"
      >
        {activeReaderStep ? (
          <FileText size={16} className="sm:w-5 sm:h-5" />
        ) : isSearching ? (
          <Globe size={16} className="sm:w-5 sm:h-5" />
        ) : (
          <BrainCircuit size={16} className="sm:w-5 sm:h-5" />
        )}
        {isStreaming || isSearching ? (
          <span className="flex items-center gap-1 sm:gap-1.5">
            <span className="truncate max-w-[240px]">{headerText}</span>
            <LoadingDots />
          </span>
        ) : (
          headerText
        )}
        {collapsed ? (
          <ChevronDown size={12} className="sm:w-3.5 sm:h-3.5" />
        ) : (
          <ChevronUp size={12} className="sm:w-3.5 sm:h-3.5" />
        )}
      </button>

      {!hasTimeline && !isSearching && safeSearchError ? (
        <div className="mt-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          联网检索失败：{safeSearchError}
        </div>
      ) : null}

      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="thinking-content bg-zinc-100 border border-zinc-200 rounded-2xl p-3 overflow-y-auto max-h-[260px] w-full max-w-[800px] text-xs text-zinc-400"
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
