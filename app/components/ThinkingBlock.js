"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, ChevronDown, ChevronUp, Lightbulb, Search, Zap } from "lucide-react";
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

export default function ThinkingBlock({ thought, isStreaming, isSearching, searchQuery, searchError, timeline, bodyText }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedTimelineId, setExpandedTimelineId] = useState(null);
  const containerRef = useRef(null);
  const autoCollapsedRef = useRef(false);
  const manualExpandedStepIdRef = useRef(null);
  const manualOpenMainRef = useRef(false);
  const safeThought = typeof thought === "string" ? thought : "";
  const safeBodyText = typeof bodyText === "string" ? bodyText : "";
  const safeSearchError = typeof searchError === "string" ? searchError : "";
  const timelineItems = normalizeTimeline(timeline);
  const hasTimeline = timelineItems.some((step) => step.kind === "search" || step.kind === "reader");
  const activeReaderStep = [...timelineItems].reverse().find((step) => step.kind === "reader" && step.status === "running");

  // 滚动到容器底部（仅简单模式的思考内容）
  useEffect(() => {
    if (!collapsed) {
      const el = containerRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      }
    }
  }, [thought, timeline, collapsed]);

  // 时间线模式：自动展开最新的思考步骤
  useEffect(() => {
    if (!hasTimeline) return;
    if (autoCollapsedRef.current) return;

    const timelineForExpand = normalizeTimeline(timeline);
    const lastStep = timelineForExpand[timelineForExpand.length - 1] || null;
    if (lastStep && lastStep.kind !== "thought") {
      setExpandedTimelineId((prev) => {
        if (prev === null) return prev;
        manualExpandedStepIdRef.current = null;
        return null;
      });
      return;
    }

    const lastThoughtStep = [...timelineForExpand]
      .reverse()
      .find((step) => step.kind === "thought");

    if (!lastThoughtStep?.id) return;
    setExpandedTimelineId((prev) => {
      if (prev === lastThoughtStep.id) return prev;
      manualExpandedStepIdRef.current = null;
      return lastThoughtStep.id;
    });
  }, [hasTimeline, timeline]);

  // 简单模式：思考流式输出时自动展开内层思考气泡
  useEffect(() => {
    if (hasTimeline) return;
    if (autoCollapsedRef.current) return;
    if (isStreaming || safeThought) {
      setExpandedTimelineId("__simple__");
    }
  }, [hasTimeline, isStreaming, safeThought]);

  // 正文开始输出后，自动折叠外层容器
  useEffect(() => {
    const currentLength = safeBodyText.length;
    if (currentLength > 0 && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true;
      manualExpandedStepIdRef.current = null;
      manualOpenMainRef.current = false;
      setCollapsed(true);
      setExpandedTimelineId(null);
    }
    if (currentLength === 0) {
      autoCollapsedRef.current = false;
    }
  }, [safeBodyText]);

  // ── 外层标题文本（始终固定） ──
  const headerText = "执行过程";

  // ── 外层图标（始终固定） ──
  const headerIcon = <Zap size={16} className="sm:w-5 sm:h-5" />;

  // ── 渲染时间线内的单个步骤（第二层折叠项）──
  const renderTimelineStep = (step, idx) => {
    const isExpanded = expandedTimelineId === step.id;
    const isRunning = step.status === "running";
    const isError = step.status === "error";

    const getTitle = () => {
      if (step.kind === "thought") return "思考过程";
      if (step.kind === "search") {
        const query = step.query ? `「${step.query}」` : "";
        if (isRunning) return `联网搜索中${query}`;
        if (isError) return `联网搜索失败${query}`;
        return `联网搜索完成${query}`;
      }
      if (step.kind === "reader") return isRunning ? "查看网页中" : (isError ? "网页读取失败" : "网页正文已读取");
      return "处理中";
    };

    const hasDetail = (() => {
      if (step.kind === "thought") return Boolean(step.content);
      if (step.kind === "search") return Boolean(step.query || Number.isFinite(step.resultCount) || (isError && step.message));
      if (step.kind === "reader") return Boolean((step.title || step.url || step.excerpt) || (isError && step.message));
      return false;
    })();
    const isThoughtStreaming = step.status === "streaming";
    const isManualExpanded = manualExpandedStepIdRef.current === step.id;
    const showThoughtDots = isThoughtStreaming && (!hasDetail || (isExpanded && !isManualExpanded));

    const titleText = getTitle();

    const icon = step.kind === "reader"
      ? <BookOpen size={14} className="sm:w-4 sm:h-4" />
      : step.kind === "search"
        ? <Search size={14} className="sm:w-4 sm:h-4" />
        : <Lightbulb size={14} className="sm:w-4 sm:h-4" />;

    const capsuleClass = `inline-flex w-fit max-w-full items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-medium py-0.5 transition-colors ${isError ? "thinking-step-error text-red-600" : "text-zinc-500"}`;

    if (step.kind === "thought") {
      const isSynthetic = step.synthetic === true;
      const showThinkingTitle = isSynthetic && isThoughtStreaming;
      const showDoneTitle = isSynthetic && !isThoughtStreaming && !hasDetail;
      return (
        <div key={step.id || `thought-${idx}`} className="w-full max-w-[760px]">
          <button
            type="button"
            onClick={() => {
              if (!hasDetail) return;
              setExpandedTimelineId((prev) => {
                if (prev === step.id) {
                  manualExpandedStepIdRef.current = null;
                  return null;
                }
                manualExpandedStepIdRef.current = step.id;
                return step.id;
              });
            }}
            className={`${capsuleClass} ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
          >
            {icon}
            <span>{showThinkingTitle ? "思考中" : (showDoneTitle ? "已思考" : titleText)}</span>
            {showThoughtDots ? <LoadingDots /> : null}
            {hasDetail ? (isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : null}
          </button>
          {hasDetail && isExpanded ? (
            <div className="thinking-content mt-1 bg-white/60 border border-zinc-200/60 rounded-xl p-2.5 overflow-y-auto max-h-[200px] w-full max-w-[760px] text-xs text-zinc-400" ref={containerRef}>
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
        <div key={step.id || `search-${idx}`} className="w-full max-w-[760px]">
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
        <div key={step.id || `reader-${idx}`} className="w-full max-w-[760px]">
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

  // ══════════════════════════════════════════
  //  统一渲染：外层执行过程容器 + 内层步骤
  // ══════════════════════════════════════════
  return (
    <div className="mb-2 w-full max-w-full">
      {/* ── 第一层：外层折叠按钮 ── */}
      <button
        onClick={() => {
          if (collapsed) {
            manualOpenMainRef.current = true;
          } else {
            manualOpenMainRef.current = false;
          }
          setCollapsed(!collapsed);
        }}
        className="thinking-btn flex items-center gap-2 sm:gap-3 text-xs sm:text-sm font-medium mb-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-colors text-zinc-500 hover:text-zinc-700 bg-zinc-100"
      >
        {headerIcon}
        <span className="flex items-center gap-1 sm:gap-1.5">
          <span className="truncate max-w-[240px]">{headerText}</span>
          {!collapsed && !manualOpenMainRef.current && (isStreaming || isSearching) ? <LoadingDots /> : null}
        </span>
        {collapsed ? (
          <ChevronDown size={12} className="sm:w-3.5 sm:h-3.5" />
        ) : (
          <ChevronUp size={12} className="sm:w-3.5 sm:h-3.5" />
        )}
      </button>

      {/* 搜索错误提示（非时间线模式） */}
      {!hasTimeline && !isSearching && safeSearchError ? (
        <div className="mt-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          联网检索失败：{safeSearchError}
        </div>
      ) : null}

      {/* ── 内层内容（第二层折叠区域）── */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {hasTimeline ? (
              /* 时间线模式：内层各步骤气泡（每个可独立折叠 = 第二层） */
              <div className="thinking-timeline flex flex-col gap-1.5 ml-1 pl-3 border-l-2 border-zinc-200/80 py-1">
                {timelineItems.map((step, idx) => renderTimelineStep(step, idx))}
              </div>
            ) : (
              /* 简单模式：内嵌一个"思考过程"气泡（第二层） */
              <div className="thinking-timeline flex flex-col gap-1.5 ml-1 pl-3 border-l-2 border-zinc-200/80 py-1">
                <div className="w-full max-w-[760px]">
                  <button
                    type="button"
                    onClick={() => {
                      if (!safeThought) return;
                      setExpandedTimelineId((prev) => prev === "__simple__" ? null : "__simple__");
                    }}
                    className={`inline-flex w-fit max-w-full items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-medium py-0.5 transition-colors text-zinc-500 ${safeThought ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <Lightbulb size={14} className="sm:w-4 sm:h-4" />
                    <span>{isStreaming ? "思考中" : "思考过程"}</span>
                    {isStreaming && expandedTimelineId !== "__simple__" ? <LoadingDots /> : null}
                    {safeThought ? (expandedTimelineId === "__simple__" ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : null}
                  </button>
                  {expandedTimelineId === "__simple__" && safeThought ? (
                    <div
                      className="thinking-content mt-1 bg-white/60 border border-zinc-200/60 rounded-xl p-2.5 overflow-y-auto max-h-[200px] w-full max-w-[760px] text-xs text-zinc-400"
                      ref={containerRef}
                    >
                      <Markdown enableHighlight={!isStreaming} className="prose-xs prose-pre:bg-zinc-800 prose-pre:text-zinc-100 prose-code:text-xs thinking-prose">
                        {safeThought}
                      </Markdown>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
