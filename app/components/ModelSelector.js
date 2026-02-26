"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp } from "lucide-react";
import { Gemini, Claude, OpenAI, Doubao } from "@lobehub/icons";
import { CHAT_MODELS } from "./ChatModels";
import { LINE_MODES } from "../lib/economyModels";

function ModelIcon({ provider, Icon, size = 16, isSelected = false }) {
  if (provider === "gemini") {
    return <Gemini.Color size={size} />;
  }
  if (provider === "claude") {
    return <Claude.Color size={size} />;
  }
  if (provider === "openai") {
    return <OpenAI size={size} />;
  }
  if (provider === "seed") {
    return <Doubao.Color size={size} />;
  }
  if (Icon) {
    return <Icon size={size} className={isSelected ? "" : "text-blue-400"} />;
  }
  return null;
}

function getModelLineMeta(modelConfig, routeMode) {
  if (modelConfig?.provider === "seed") {
    return { label: "优质", className: "text-green-500" };
  }

  if (modelConfig?.provider === "claude" || modelConfig?.provider === "openai") {
    return { label: "经济", className: "text-yellow-500" };
  }

  if (routeMode === LINE_MODES.ECONOMY) {
    return { label: "经济", className: "text-yellow-500" };
  }

  return { label: "优质", className: "text-green-500" };
}

export default function ModelSelector({ model, onModelChange, routeMode }) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const visibleModels = CHAT_MODELS;
  const currentModel = CHAT_MODELS.find((m) => m.id === model);
  const currentModelLine = getModelLineMeta(currentModel, routeMode);
  const currentModelLabel = currentModel?.shortName || currentModel?.name || "模型";

  const renderModelGroup = (provider, title) => {
    const models = visibleModels.filter((m) => m.provider === provider);
    if (models.length === 0) return null;
    return (
      <>
        <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{title}</div>
        {models.map((m) => {
          const lineMeta = getModelLineMeta(m, routeMode);
          return (
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
              <span>{m.name}</span>
              <span className={`ml-auto text-xs font-semibold ${lineMeta.className}`}>
                {lineMeta.label}
              </span>
            </button>
          );
        })}
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
        <span className="truncate max-w-[90px]">{currentModelLabel}</span>
        <span className={`text-xs font-semibold ml-auto ${currentModelLine.className}`}>
          {currentModelLine.label}
        </span>
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
              {renderModelGroup("gemini", "Gemini")}
              <div className="my-1.5 border-t border-zinc-200" />
              {renderModelGroup("claude", "Claude")}
              <div className="my-1.5 border-t border-zinc-200" />
              {renderModelGroup("openai", "OpenAI")}
              <div className="my-1.5 border-t border-zinc-200" />
              {renderModelGroup("seed", "Seed")}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
