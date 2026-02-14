"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp, Shield, ShieldOff } from "lucide-react";
import { Gemini, Claude, OpenAI, Perplexity } from "@lobehub/icons";
import { CHAT_MODELS } from "./ChatModels";

function ModelIcon({ provider, Icon, size = 16, isSelected = false }) {
  if (provider === "council") {
    return <Perplexity.Color size={size} />;
  }
  if (provider === "gemini") {
    return <Gemini.Color size={size} />;
  }
  if (provider === "claude") {
    return <Claude.Color size={size} />;
  }
  if (provider === "openai") {
    return <OpenAI size={size} />;
  }
  if (Icon) {
    return <Icon size={size} className={isSelected ? "" : "text-blue-400"} />;
  }
  return null;
}

export default function ModelSelector({ model, onModelChange, isPremium }) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const visibleModels = isPremium ? CHAT_MODELS : CHAT_MODELS.filter((m) => !m.premium);
  const currentModel = visibleModels.find((m) => m.id === model);

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
            <ModelIcon provider={m.provider} size={16} isSelected={model === m.id} />
            {m.name}
            {m.provider !== "council" && (
              <button
                className="ml-auto relative group"
                type="button"
                tabIndex={0}
                aria-label={m.privacy ? "您的数据不会被用于训练模型" : "您的数据可能被用于训练模型"}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                {m.privacy ? (
                  <Shield
                    size={14}
                    className={`${model === m.id ? "text-white/90" : "text-emerald-500"}`}
                    title="您的数据不会被用于训练模型"
                  />
                ) : (
                  <ShieldOff
                    size={14}
                    className={`${model === m.id ? "text-white/90" : "text-red-500"}`}
                    title="您的数据可能被用于训练模型"
                  />
                )}
                <span className="pointer-events-none absolute right-0 top-full mt-1 w-max max-w-[220px] rounded-md bg-zinc-900 px-2 py-1 text-[10px] text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100 group-active:opacity-100">
                  {m.privacy ? "您的数据不会被用于训练模型" : "您的数据可能被用于训练模型"}
                </span>
              </button>
            )}
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
          <ModelIcon
            provider={currentModel.provider}
            Icon={currentModel.Icon}
            size={14}
            isSelected={true}
          />
        )}
        <span className="hidden sm:inline">{currentModel?.shortName}</span>
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
              {isPremium && (
                <>
                  {renderModelGroup("council", "Council")}
                  <div className="my-1.5 border-t border-zinc-200" />
                </>
              )}
              {renderModelGroup("gemini", "Gemini")}
              <div className="my-1.5 border-t border-zinc-200" />
              {renderModelGroup("claude", "Claude")}
              <div className="my-1.5 border-t border-zinc-200" />
              {renderModelGroup("openai", "OpenAI")}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
