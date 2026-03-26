"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp } from "lucide-react";
import { CHAT_MODELS, PRIMARY_CHAT_MODELS } from "@/lib/shared/models";
import { ModelGlyph } from "./ModelVisuals";

export default function ModelSelector({ model, agentModel, onModelChange, ready = true }) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const currentModel = ready ? CHAT_MODELS.find((item) => item.id === model) : null;
  const currentModelLabel = currentModel?.name || "模式";

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!ready) return;
          setShowModelMenu((value) => !value);
        }}
        className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1.5 text-sm"
        type="button"
        disabled={!ready}
      >
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center shrink-0">
          {currentModel ? (
            <ModelGlyph model={currentModel.id} provider={currentModel.provider} agentModel={agentModel} size={14} />
          ) : (
            <span className="block h-3.5 w-3.5 rounded-sm bg-zinc-200" aria-hidden />
          )}
        </span>
        <span className="hidden truncate max-w-[160px] sm:inline-block">{currentModelLabel}</span>
        <ChevronUp
          size={12}
          className={`transition-transform ${showModelMenu ? "rotate-180" : ""} ${ready ? "" : "opacity-40"}`}
        />
      </button>

      <AnimatePresence>
        {ready && showModelMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setShowModelMenu(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full left-0 mb-2 w-[min(64vw,196px)] bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 p-2 z-50"
            >
              <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 tracking-wider">
                主模式
              </div>
              {PRIMARY_CHAT_MODELS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    if (!ready) return;
                    setShowModelMenu(false);
                    onModelChange(item.id);
                  }}
                  className={`w-full px-3 py-2.5 rounded-lg text-sm md:text-[13px] font-medium flex items-center gap-2.5 transition-colors ${
                    model === item.id
                      ? "bg-zinc-600 text-white"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
                  type="button"
                >
                  <ModelGlyph model={item.id} provider={item.provider} agentModel={agentModel} size={16} />
                  <span className="leading-tight break-words text-left">{item.name}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
