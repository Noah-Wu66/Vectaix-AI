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
  enableMath = false,
  citations = null,
  showInlineCitations = false,
}) {
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

  const remarkPlugins = enableMath ? [remarkMath, remarkGfm] : [remarkGfm];
  const rehypePlugins = [[rehypeSanitize, sanitizeSchema]];

  if (enableMath) {
    rehypePlugins.push([rehypeKatex, { strict: "ignore" }]);
  }

  if (actualHighlight) {
    rehypePlugins.push(rehypeHighlight);
  }

  const inlineCitationItems = buildInlineCitationItems(citations);
  const shouldRenderInlineCitations = showInlineCitations && inlineCitationItems.length > 0;

  const renderInlineCitations = () => (
    shouldRenderInlineCitations
      ? <InlineCitationLinks items={inlineCitationItems} />
      : null
  );

  return (
    <div
      className={`prose prose-sm max-w-none prose-zinc prose-pre:bg-zinc-900 prose-pre:text-zinc-100 prose-code:before:content-none prose-code:after:content-none ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          p: ({ children, ...props }) => (
            <p {...props}>
              {children}
              {renderInlineCitations()}
            </p>
          ),
          li: ({ node, children, ...props }) => {
            const hasParagraphChild = Array.isArray(node?.children)
              && node.children.some((child) => child?.type === "element" && child?.tagName === "p");
            return (
              <li {...props}>
                {children}
                {!hasParagraphChild ? renderInlineCitations() : null}
              </li>
            );
          },
          table: ({ children, ...props }) => (
            <div className="table-scroll-wrapper">
              <table {...props}>{children}</table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th {...props}>
              <div className="table-cell-inner">{children}</div>
            </th>
          ),
          td: ({ children, ...props }) => (
            <td {...props}>
              <div className="table-cell-inner">{children}</div>
            </td>
          ),
          code: ({ node, className, children, inline, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const lang = match ? match[1] : "";
            
            if (inline) {
              return <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[13px] font-mono text-primary" {...props}>{children}</code>;
            }

            return (
              <div className="relative group/code my-4 rounded-xl overflow-hidden border border-zinc-200/50 shadow-sm">
                <div className="flex items-center justify-between px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200/50 text-[11px] font-bold text-zinc-500 uppercase tracking-widest">
                  <span>{lang || "code"}</span>
                  <CodeCopyButton text={String(children).replace(/\n$/, "")} />
                </div>
                <pre className="!bg-zinc-900 !m-0 !rounded-none p-4 overflow-x-auto scrollbar-thin">
                  <code className={`${className} !bg-transparent text-[13.5px] leading-relaxed`} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function buildInlineCitationItems(citations) {
  if (!Array.isArray(citations) || citations.length === 0) return [];

  const items = [];
  const seenDomains = new Set();

  for (const citation of citations) {
    const url = typeof citation?.url === "string" ? citation.url : "";
    const domain = getDomainFromUrl(url);
    if (!url || !domain || seenDomains.has(domain)) continue;
    seenDomains.add(domain);
    items.push({ url, domain });
  }

  return items;
}

function InlineCitationLinks({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const visibleItems = items.slice(0, 3);
  const remainingCount = items.length - visibleItems.length;

  return (
    <span className="ml-1 inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[0.9em] text-zinc-500">
      {visibleItems.map((item, index) => (
        <span key={item.url} className="inline-flex items-center">
          {index > 0 ? <span className="mx-1 text-zinc-400">·</span> : null}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary no-underline hover:underline"
            title={item.url}
          >
            {item.domain}
          </a>
        </span>
      ))}
      {remainingCount > 0 ? <span className="ml-1 text-zinc-400">+{remainingCount}</span> : null}
    </span>
  );
}

function CodeCopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 hover:text-primary transition-colors"
    >
      {copied ? (
        <>
          <Check size={12} />
          <span>COPIED</span>
        </>
      ) : (
        <>
          <Copy size={12} />
          <span>COPY</span>
        </>
      )}
    </button>
  );
}
