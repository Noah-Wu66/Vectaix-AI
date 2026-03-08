"use client";
import { useMemo, useState, useRef, useEffect, useCallback } from "react";

/**
 * 估算文本的 token 数量
 * 中文字符 ~1.5 token，ASCII ~0.25 token/字符，其他 ~0.5 token/字符
 */
function estimateTokens(text) {
  if (!text || typeof text !== "string" || text.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)) {
      total += 1.5; // CJK 常用 + 扩展 A
    } else if (c >= 0x3000 && c <= 0x303F) {
      total += 1; // CJK 标点
    } else if (c >= 0xFF00 && c <= 0xFFEF) {
      total += 1; // 全角字符
    } else if (c <= 0x7F) {
      total += 0.25; // ASCII
    } else {
      total += 0.5; // 其他 Unicode
    }
  }
  return Math.max(1, Math.ceil(total));
}

/** 格式化 token 数量为可读字符串 */
function formatTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 100000) return `${(n / 1000).toFixed(0)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** 格式化 token 数量（详情用，带千分位） */
function formatTokensDetail(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  return n.toLocaleString("zh-CN");
}

// SVG 圆环参数
const SIZE = 22;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function TokenCounter({
  messages,
  systemPrompts,
  activePromptId,
  historyLimit,
  contextWindow,
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const containerRef = useRef(null);
  const touchTimerRef = useRef(null);

  const tokenData = useMemo(() => {
    // 1. 系统提示词 tokens
    const activePrompt = systemPrompts?.find(
      (p) => String(p?._id) === String(activePromptId)
    );
    const systemPromptText = activePrompt?.content || "";
    // 系统提示词 + 时间注入（约 80 chars） + 格式约束（约 160 chars）
    const systemTokens = estimateTokens(systemPromptText) + 60;

    // 2. 有效消息（考虑 historyLimit）
    const allMessages = Array.isArray(messages) ? messages : [];
    const limit = Number(historyLimit);
    const effectiveMessages =
      limit > 0 && Number.isFinite(limit)
        ? allMessages.slice(-limit)
        : allMessages;

    let contentTokens = 0;
    let thoughtTokens = 0;
    let imageCount = 0;
    let searchContextTokens = 0;

    for (const msg of effectiveMessages) {
      if (!msg) continue;

      // 消息内容
      if (msg.content) {
        contentTokens += estimateTokens(msg.content);
      }

      // 思考/推理内容（消耗上下文窗口的输出部分）
      if (msg.thought) {
        thoughtTokens += estimateTokens(msg.thought);
      }

      // 图片（每张高分辨率图片约 1000 tokens）
      if (Array.isArray(msg.parts) && msg.parts.length > 0) {
        for (const part of msg.parts) {
          const url = part?.inlineData?.url;
          if (typeof url === "string" && url) imageCount += 1;
        }
      }

      // 联网搜索注入的上下文 tokens（由后端计算）
      if (typeof msg.searchContextTokens === "number" && msg.searchContextTokens > 0) {
        searchContextTokens += msg.searchContextTokens;
      }
    }

    const imageTokens = imageCount * 1000;
    // 每条消息的格式开销（role 标签、分隔符等）
    const overheadTokens = effectiveMessages.length * 4;

    const totalTokens =
      systemTokens + contentTokens + thoughtTokens + imageTokens + searchContextTokens + overheadTokens;
    const maxTokens = contextWindow || 1000000;
    const percentage = Math.min(100, (totalTokens / maxTokens) * 100);

    return {
      systemTokens,
      contentTokens,
      thoughtTokens,
      imageTokens,
      imageCount,
      searchContextTokens,
      overheadTokens,
      totalTokens,
      maxTokens,
      percentage,
      messageCount: effectiveMessages.length,
      totalMessages: allMessages.length,
      isLimited: limit > 0 && Number.isFinite(limit) && allMessages.length > limit,
    };
  }, [messages, systemPrompts, activePromptId, historyLimit, contextWindow]);

  // 进度颜色类
  const getProgressClass = useCallback((pct) => {
    if (pct >= 90) return "token-progress-red";
    if (pct >= 70) return "token-progress-orange";
    if (pct >= 50) return "token-progress-amber";
    return "token-progress-neutral";
  }, []);

  const progressClass = getProgressClass(tokenData.percentage);
  const strokeDashoffset =
    CIRCUMFERENCE - (tokenData.percentage / 100) * CIRCUMFERENCE;

  // 点击外部关闭 tooltip
  useEffect(() => {
    if (!showTooltip) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowTooltip(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [showTooltip]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    };
  }, []);

  const handleMouseEnter = () => setShowTooltip(true);
  const handleMouseLeave = () => setShowTooltip(false);
  const handleTouchStart = (e) => {
    e.stopPropagation();
    setShowTooltip((v) => !v);
  };

  return (
    <div
      ref={containerRef}
      className="relative flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 圆形进度环 */}
      <button
        type="button"
        className="token-counter-ring flex items-center justify-center"
        onTouchStart={handleTouchStart}
        aria-label={`Token 使用量: ${formatTokens(tokenData.totalTokens)} / ${formatTokens(tokenData.maxTokens)}`}
        style={{ width: SIZE, height: SIZE }}
      >
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="token-counter-svg"
        >
          {/* 背景环 */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            className="token-counter-bg-ring"
            strokeWidth={STROKE}
          />
          {/* 进度环 */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            className={progressClass}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={strokeDashoffset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.3s ease" }}
          />
        </svg>
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="token-counter-tooltip">
          <div className="token-tooltip-header">上下文使用量</div>
          <div className="token-tooltip-rows">
            <div className="token-tooltip-row">
              <span className="token-tooltip-label">系统提示词</span>
              <span className="token-tooltip-value">
                ~{formatTokensDetail(tokenData.systemTokens)}
              </span>
            </div>
            <div className="token-tooltip-row">
              <span className="token-tooltip-label">
                对话内容
                {tokenData.isLimited && (
                  <span className="token-tooltip-note">
                    （最近 {Number(historyLimit)} 条）
                  </span>
                )}
              </span>
              <span className="token-tooltip-value">
                ~{formatTokensDetail(tokenData.contentTokens)}
              </span>
            </div>
            {tokenData.thoughtTokens > 0 && (
              <div className="token-tooltip-row">
                <span className="token-tooltip-label">思考过程</span>
                <span className="token-tooltip-value">
                  ~{formatTokensDetail(tokenData.thoughtTokens)}
                </span>
              </div>
            )}
            {tokenData.imageCount > 0 && (
              <div className="token-tooltip-row">
                <span className="token-tooltip-label">
                  图片（{tokenData.imageCount} 张）
                </span>
                <span className="token-tooltip-value">
                  ~{formatTokensDetail(tokenData.imageTokens)}
                </span>
              </div>
            )}
            {tokenData.searchContextTokens > 0 && (
              <div className="token-tooltip-row">
                <span className="token-tooltip-label">联网搜索</span>
                <span className="token-tooltip-value">
                  ~{formatTokensDetail(tokenData.searchContextTokens)}
                </span>
              </div>
            )}
          </div>
          <div className="token-tooltip-divider" />
          <div className="token-tooltip-total">
            <span>总计</span>
            <span>
              ~{formatTokensDetail(tokenData.totalTokens)} /{" "}
              {formatTokens(tokenData.maxTokens)}
            </span>
          </div>
          {/* 进度条 */}
          <div className="token-tooltip-bar-bg">
            <div
              className={`token-tooltip-bar-fill ${progressClass}-bar`}
              style={{
                width: `${Math.max(0.5, tokenData.percentage)}%`,
              }}
            />
          </div>
          <div className={`token-tooltip-pct ${progressClass}-text`}>
            {tokenData.percentage < 0.1
              ? "<0.1%"
              : tokenData.percentage < 1
                ? tokenData.percentage.toFixed(1) + "%"
                : Math.round(tokenData.percentage) + "%"}
          </div>
        </div>
      )}
    </div>
  );
}
