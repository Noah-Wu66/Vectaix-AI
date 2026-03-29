"use client";

import {
  CHAT_RUNTIME_MODES,
  DEFAULT_CHAT_RUNTIME_MODE,
  isCouncilModel,
} from "@/lib/shared/models";

export default function ModeSwitcher({
  model,
  chatMode,
  onChatModeChange,
  ready = true,
}) {
  const councilOnly = isCouncilModel(model);

  if (councilOnly) {
    return (
      <div className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-900/70 p-0.5">
        <span className="px-3 py-1.5 rounded-md text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
          Chat
        </span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-900/70 p-0.5">
      {CHAT_RUNTIME_MODES.map((item) => {
        const active = (chatMode || DEFAULT_CHAT_RUNTIME_MODE) === item.id;
        return (
          <button
            key={item.id}
            onClick={() => {
              if (!ready || active) return;
              onChatModeChange?.(item.id);
            }}
            type="button"
            disabled={!ready}
            title={item.description}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              active
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100"
            } ${ready ? "" : "opacity-50 cursor-not-allowed"}`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
