"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp } from "lucide-react";
import { CHAT_MODELS, MODEL_GROUP_ORDER } from "@/lib/shared/models";
import { ModelGlyph } from "./ModelVisuals";

export default function ModelSelector({ model, onModelChange }) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const visibleModels = CHAT_MODELS;
  const currentModel = CHAT_MODELS.find((m) => m.id === model);
  const currentModelLabel = currentModel?.shortName || currentModel?.name || "模型";
  const groupTitles = {
    council: "Council",
    gemini: "Gemini",
    claude: "Claude",
    openai: "OpenAI",
    seed: "DOUBAO",
    deepseek: "DeepSeek",
  };

  const renderModelGroup = (provider, title) => {
    const models = visibleModels.filter((m) => m.provider === provider);
    if (models.length === 0) return null;
    return (
      <>
        <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{title}</div>
        {models.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              setShowModelMenu(false);
              onModelChange(m.id);
            }}
            className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2.5 transition-colors ${model === m.id
              ? "bg-zinc-600 text-white"
              : "text-zinc-600 hover:bg-zinc-50"
              }`}
            type="button"
          >
            <ModelGlyph provider={m.provider} size={16} />
            <span>{m.name}</span>
          </button>
        ))}
      </>
    );
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowModelMenu(!showModelMenu)}
        className="px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors flex items-center gap-1.5 text-sm"
        type="button"
      >
        {currentModel && (
          <ModelGlyph provider={currentModel.provider} size={14} />
        )}
        <span className="truncate max-w-[90px]">{currentModelLabel}</span>
        <ChevronUp
          size={12}
          className={`transition-transform ${showModelMenu ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {showModelMenu && (
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
              className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-zinc-200 p-2 z-50 min-w-[160px]"
            >
              {MODEL_GROUP_ORDER.map((provider, index) => (
                <div key={provider}>
                  {index > 0 && <div className="my-1.5 border-t border-zinc-200" />}
                  {renderModelGroup(provider, groupTitles[provider] || provider)}
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
