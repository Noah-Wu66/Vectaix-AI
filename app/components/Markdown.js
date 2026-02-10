"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Copy, Check } from "lucide-react";

// Sanitize user markdown before rendering KaTeX/highlight output
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
  },
};

const codeAttributes = Array.isArray(defaultSchema.attributes?.code)
  ? [...defaultSchema.attributes.code]
  : [];
const codeClassIndex = codeAttributes.findIndex(
  (entry) => Array.isArray(entry) && entry[0] === "className"
);

if (codeClassIndex >= 0) {
  const current = codeAttributes[codeClassIndex];
  codeAttributes[codeClassIndex] = [
    "className",
    ...current.slice(1),
    "math-inline",
    "math-display",
  ];
} else {
  codeAttributes.push(["className", "math-inline", "math-display"]);
}

sanitizeSchema.attributes.code = codeAttributes;

export default function Markdown({
  children,
  className = "",
  enableHighlight = true,
  streaming = false,
  streamKey = 0,
}) {
  // 使用 ref 记住上一次的 enableHighlight 值，避免重复触发
  const prevEnableRef = useRef(enableHighlight);
  const prevStreamKeyRef = useRef(streamKey);
  const lastPulseAtRef = useRef(0);
  const [actualHighlight, setActualHighlight] = useState(enableHighlight);
  const [streamPulse, setStreamPulse] = useState(false);

  useEffect(() => {
    // 只有当从 false -> true 时才延迟启用，避免闪烁
    if (!prevEnableRef.current && enableHighlight) {
      const timer = setTimeout(() => setActualHighlight(true), 50);
      prevEnableRef.current = enableHighlight;
      return () => clearTimeout(timer);
    }
    // 其他情况直接同步
    setActualHighlight(enableHighlight);
    prevEnableRef.current = enableHighlight;
  }, [enableHighlight]);

  useEffect(() => {
    if (!streaming) {
      prevStreamKeyRef.current = streamKey;
      lastPulseAtRef.current = 0;
      setStreamPulse(false);
      return;
    }

    const prevKey = Number.isFinite(prevStreamKeyRef.current) ? prevStreamKeyRef.current : 0;
    const nextKey = Number.isFinite(streamKey) ? streamKey : 0;
    const delta = Math.max(0, nextKey - prevKey);
    prevStreamKeyRef.current = nextKey;

    if (delta <= 0) return;

    const now = Date.now();
    const elapsed = now - lastPulseAtRef.current;
    const shouldPulse = delta >= 20 || elapsed >= 520;
    if (!shouldPulse) return;
    lastPulseAtRef.current = now;

    setStreamPulse(false);
    const rafId = requestAnimationFrame(() => setStreamPulse(true));
    const timer = setTimeout(() => setStreamPulse(false), 680);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
    };
  }, [streaming, streamKey]);

  // Sanitize first, then render KaTeX/highlight output
  const rehypePlugins = actualHighlight
    ? [[rehypeSanitize, sanitizeSchema], rehypeKatex, rehypeHighlight]
    : [[rehypeSanitize, sanitizeSchema], rehypeKatex];

  const streamClass = streaming
    ? `stream-flow ${streamPulse ? "stream-flow-pulse" : ""}`
    : "";

  return (
    <div
      className={`prose prose-sm max-w-none prose-zinc prose-pre:bg-zinc-900 prose-pre:text-zinc-100 prose-code:before:content-none prose-code:after:content-none ${streamClass} ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          code: ({ node, className, children, inline, ...props }) => {
            // inline prop is passed by react-markdown for inline code
            // For code blocks without language, className is undefined but inline is false
            if (inline) {
              return <code {...props}>{children}</code>;
            }

            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => {
            const [isCopied, setIsCopied] = useState(false);
            const preRef = useRef(null);

            const handleCopy = async () => {
              const text = preRef.current?.textContent;
              try {
                await navigator.clipboard.writeText(text);
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000);
              } catch { }
            };

            return (
              <div className="relative group">
                <button
                  onClick={handleCopy}
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-center gap-1"
                  title={isCopied ? "已复制" : "复制代码"}
                >
                  {isCopied ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <pre ref={preRef} className="rounded-lg overflow-x-auto p-4 my-3">{children}</pre>
              </div>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
