"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp } from "lucide-react";
import { CHAT_MODELS, MODEL_GROUP_ORDER, MODEL_GROUP_TITLES } from "@/lib/shared/models";
import { ModelGlyph } from "./ModelVisuals";

export default function ModelSelector({ model, onModelChange, ready = true }) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showOtherModels, setShowOtherModels] = useState(() => {
    const current = ready ? CHAT_MODELS.find((m) => m.id === model) : null;
    return current ? (current.provider !== "vectaix" && current.provider !== "council") : false;
  });
  const visibleModels = CHAT_MODELS;
  const currentModel = ready ? CHAT_MODELS.find((m) => m.id === model) : null;
  const currentModelLabel = currentModel?.name || "模型";
  const groupProviders = {
    vectaix: ["council", "vectaix"],
    gemini: ["gemini"],
    claude: ["claude"],
    openai: ["openai"],
    seed: ["seed"],
    deepseek: ["deepseek"],
    xiaomi: ["xiaomi"],
    minimax: ["minimax"],
  };

  const renderModelGroup = (groupKey, title) => {
    const providers = groupProviders[groupKey] || [groupKey];
    const models = visibleModels.filter((m) => providers.includes(m.provider));
    if (models.length === 0) return null;
    return (
      <>
        <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 tracking-wider">{title}</div>
        {models.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              if (!ready) return;
              setShowModelMenu(false);
              onModelChange(m.id);
            }}
            className={`w-full px-3 py-2.5 rounded-lg text-sm md:text-[13px] font-medium flex items-center gap-2.5 transition-colors ${model === m.id
              ? "bg-zinc-600 text-white"
              : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            type="button"
          >
            <ModelGlyph model={m.id} provider={m.provider} size={16} />
            <span className="leading-tight break-words text-left">{m.name}</span>
          </button>
        ))}
      </>
    );
  };

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!ready) return;
          setShowModelMenu(!showModelMenu);
        }}
        className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1.5 text-sm"
        type="button"
        disabled={!ready}
      >
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center shrink-0">
          {currentModel ? (
            <ModelGlyph model={currentModel.id} provider={currentModel.provider} size={14} />
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
              className="absolute bottom-full left-0 mb-2 w-[min(68vw,196px)] bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 p-2 z-50"
            >
              <div key="vectaix">
                {renderModelGroup("vectaix", MODEL_GROUP_TITLES.vectaix)}
              </div>
              <div className="my-1.5 border-t border-zinc-200 dark:border-zinc-700" />
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowOtherModels(!showOtherModels);
                }}
                className="w-full px-3 py-1.5 flex items-center justify-between text-[10px] font-semibold text-zinc-400 tracking-wider hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                type="button"
              >
                <span>其他模型</span>
                <ChevronUp
                  size={12}
                  className={`transition-transform ${showOtherModels ? "" : "rotate-180"}`}
                />
              </button>
              <AnimatePresence initial={false}>
                {showOtherModels && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    {MODEL_GROUP_ORDER.filter((g) => g !== "vectaix").map((groupKey, index) => (
                      <div key={groupKey}>
                        {index > 0 && <div className="my-1.5 border-t border-zinc-200 dark:border-zinc-700" />}
                        {renderModelGroup(groupKey, MODEL_GROUP_TITLES[groupKey] || groupKey)}
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
