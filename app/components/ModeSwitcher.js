"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp } from "lucide-react";
import {
  CHAT_RUNTIME_MODES,
  COUNCIL_MODEL_ID,
  DEFAULT_CHAT_RUNTIME_MODE,
  isCouncilModel,
} from "@/lib/shared/models";

const MODE_OPTIONS = Object.freeze([
  ...CHAT_RUNTIME_MODES,
  {
    id: COUNCIL_MODEL_ID,
    label: "Council",
    description: "多模型协作模式",
  },
]);

export default function ModeSwitcher({
  model,
  chatMode,
  onModeChange,
  ready = true,
}) {
  const [showModeMenu, setShowModeMenu] = useState(false);
  const currentModeId = isCouncilModel(model) ? COUNCIL_MODEL_ID : (chatMode || DEFAULT_CHAT_RUNTIME_MODE);
  const currentMode = MODE_OPTIONS.find((item) => item.id === currentModeId) || MODE_OPTIONS[0];

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!ready) return;
          setShowModeMenu((value) => !value);
        }}
        className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1.5 text-sm"
        type="button"
        disabled={!ready}
      >
        <span className="truncate max-w-[140px]">{currentMode.label}</span>
        <ChevronUp
          size={12}
          className={`transition-transform ${showModeMenu ? "rotate-180" : ""} ${ready ? "" : "opacity-40"}`}
        />
      </button>

      <AnimatePresence>
        {ready && showModeMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setShowModeMenu(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full left-0 mb-2 w-[min(90vw,240px)] bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 p-2 z-50"
            >
              <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 tracking-wider">
                模式
              </div>
              <div className="space-y-1">
                {MODE_OPTIONS.map((item) => {
                  const active = currentModeId === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        if (!ready || active) return;
                        setShowModeMenu(false);
                        onModeChange?.(item.id);
                      }}
                      className={`w-full px-3 py-2.5 rounded-lg text-sm md:text-[13px] font-medium text-left transition-colors ${
                        active
                          ? "bg-zinc-600 text-white"
                          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      }`}
                      type="button"
                      title={item.description}
                    >
                      <div>{item.label}</div>
                      <div className={`mt-1 text-xs ${active ? "text-white/70" : "text-zinc-400 dark:text-zinc-500"}`}>
                        {item.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
