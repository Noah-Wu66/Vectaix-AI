"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { COUNCIL_MODEL_ID } from "@/lib/shared/models";
import Markdown from "./Markdown";
import { Citations } from "./MessageListHelpers";
import { ModelGlyph } from "./ModelVisuals";

export default function CouncilExpertsBlock({ experts }) {
  const items = useMemo(
    () => (Array.isArray(experts) ? experts.filter((item) => item && typeof item === "object") : []),
    [experts]
  );
  const [collapsed, setCollapsed] = useState(true);
  const [openLabels, setOpenLabels] = useState({});

  if (items.length === 0) return null;

  return (
    <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50/90">
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-zinc-700"
      >
        <span className="inline-flex items-center gap-2">
          <ModelGlyph model={COUNCIL_MODEL_ID} size={16} />
          专家原始回答
        </span>
        {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>

      {!collapsed && (
        <div className="border-t border-zinc-200 px-3 py-3">
          <div className="space-y-2">
            {items.map((expert) => {
              const label = typeof expert.label === "string" ? expert.label : "专家";
              const content = typeof expert.content === "string" ? expert.content : "";
              const isOpen = openLabels[label] === true;
              return (
                <div key={label} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenLabels((prev) => ({
                        ...prev,
                        [label]: !prev[label],
                      }))
                    }
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-zinc-700"
                  >
                    <span className="truncate">{label}</span>
                    {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>

                  {isOpen && (
                    <div className="border-t border-zinc-200 px-4 py-3">
                      <Markdown enableHighlight={true}>{content}</Markdown>
                      <Citations citations={expert.citations} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
