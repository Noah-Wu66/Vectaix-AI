"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp, X } from "lucide-react";
import {
  CHAT_RUNTIME_MODE_CHAT,
  COUNCIL_MODEL_ID,
  isCouncilModel,
} from "@/lib/shared/models";

const MODE_OPTIONS = Object.freeze([
  {
    id: CHAT_RUNTIME_MODE_CHAT,
    label: "Chat",
    description: "标准聊天模式",
  },
  {
    id: COUNCIL_MODEL_ID,
    label: "Council",
    description: "多模型协作模式",
  },
]);

export default function ModeSwitcher({
  model,
  onModeChange,
  ready = true,
}) {
  const [showModeMenu, setShowModeMenu] = useState(false);
  const currentModeId = isCouncilModel(model) ? COUNCIL_MODEL_ID : CHAT_RUNTIME_MODE_CHAT;
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
            {/* 背景遮罩 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/20"
              onClick={() => setShowModeMenu(false)}
            />
            {/* 底部上拉菜单 */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-zinc-900 rounded-t-2xl shadow-2xl border-t border-zinc-200 dark:border-zinc-700"
            >
              {/* 拖拽把手 */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              </div>
              {/* 标题栏 */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">选择模式</span>
                <button
                  onClick={() => setShowModeMenu(false)}
                  className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  type="button"
                >
                  <X size={18} />
                </button>
              </div>
              {/* 选项列表 */}
              <div className="p-4 space-y-2 max-h-[50vh] overflow-auto">
                {MODE_OPTIONS.map((item) => {
                  const active = currentModeId === item.id;
                  const disabled = item.disabled === true;
                  const itemTitle = disabled
                    ? (item.disabledReason || "暂不可用")
                    : item.description;
                  return (
                    <div key={item.id} title={itemTitle}>
                      <button
                        onClick={() => {
                          if (!ready || active || disabled) return;
                          setShowModeMenu(false);
                          onModeChange?.(item.id);
                        }}
                        className={`w-full px-4 py-4 rounded-xl text-left transition-colors ${
                          active
                            ? "bg-zinc-600 text-white"
                            : disabled
                              ? "bg-zinc-100 dark:bg-zinc-800/60 text-zinc-400 dark:text-zinc-500 cursor-not-allowed"
                              : "text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                        type="button"
                        disabled={disabled}
                        aria-disabled={disabled}
                      >
                        <div className="font-medium text-base">{item.label}</div>
                        <div className={`text-sm mt-1 ${active ? "text-zinc-200" : "text-zinc-500 dark:text-zinc-400"}`}>
                          {item.description}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
              {/* 底部安全区域 */}
              <div className="h-6" />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
