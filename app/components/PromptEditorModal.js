"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export default function PromptEditorModal({
  open,
  title,
  name,
  content,
  onNameChange,
  onContentChange,
  onClose,
  onSave,
  saving = false,
}) {
  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/40" />
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6"
          >
            <button
              onClick={onClose}
              disabled={saving}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              <X size={18} />
            </button>

            <div className="text-left">
              <h3 className="text-lg font-semibold text-zinc-800 mb-4">{title}</h3>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="名称"
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-lg p-2.5 text-sm focus:outline-none focus:border-zinc-400"
                />
                <textarea
                  placeholder="提示词内容..."
                  value={content}
                  onChange={(e) => onContentChange(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-lg p-2.5 text-sm resize-none focus:outline-none focus:border-zinc-400"
                  rows={5}
                />
              </div>

              <div className="flex gap-3 mt-5">
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  type="button"
                >
                  取消
                </button>
                <button
                  onClick={onSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-zinc-600 hover:bg-zinc-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  type="button"
                >
                  保存
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
