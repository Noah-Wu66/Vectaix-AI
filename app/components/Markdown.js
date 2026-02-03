"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Copy, Check } from "lucide-react";

// Extended schema to allow KaTeX and highlight.js classes while sanitizing dangerous content (updated)
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
  },
};

if (Array.isArray(sanitizeSchema.attributes?.code)) {
  sanitizeSchema.attributes.code = [...sanitizeSchema.attributes.code, "className"];
}
if (Array.isArray(sanitizeSchema.attributes?.span)) {
  sanitizeSchema.attributes.span = [...sanitizeSchema.attributes.span, "className", "style"];
}
if (Array.isArray(sanitizeSchema.attributes?.div)) {
  sanitizeSchema.attributes.div = [...sanitizeSchema.attributes.div, "className"];
}

export default function Markdown({ children, className = "", enableHighlight = true }) {
  // 使用 ref 记住上一次的 enableHighlight 值，避免重复触发
  const prevEnableRef = useRef(enableHighlight);
  const [actualHighlight, setActualHighlight] = useState(enableHighlight);

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

  // Sanitize must be last to clean content from all preceding plugins (KaTeX CVE-2020-28170 etc.)
  const rehypePlugins = actualHighlight
    ? [rehypeKatex, rehypeHighlight, [rehypeSanitize, sanitizeSchema]]
    : [rehypeKatex, [rehypeSanitize, sanitizeSchema]];
  return (
    <div
      className={`prose prose-sm max-w-none prose-zinc prose-pre:bg-zinc-900 prose-pre:text-zinc-100 prose-code:before:content-none prose-code:after:content-none ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          code: ({ node, className, children, inline, ...props }) => {
            // inline prop is passed by react-markdown for inline code
            // For code blocks without language, className is undefined but inline is false
            if (inline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-800 text-sm font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
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
