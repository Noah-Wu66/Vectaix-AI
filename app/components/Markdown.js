"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// Extended schema to allow KaTeX and highlight.js classes while sanitizing dangerous content
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), "className"],
    span: [...(defaultSchema.attributes?.span || []), "className", "style"],
    div: [...(defaultSchema.attributes?.div || []), "className"],
  },
};

export default function Markdown({ children, className = "", enableHighlight = true }) {
  // Sanitize must be last to clean content from all preceding plugins (KaTeX CVE-2020-28170 etc.)
  const rehypePlugins = enableHighlight
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
          pre: ({ children }) => (
            <pre className="rounded-lg overflow-x-auto p-4 my-3">{children}</pre>
          ),
        }}
      >
        {children ?? ""}
      </ReactMarkdown>
    </div>
  );
}