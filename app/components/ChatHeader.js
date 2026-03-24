"use client";

import { Menu } from "lucide-react";

export default function ChatHeader({ onToggleSidebar }) {
  return (
    <header className="px-4 py-3 glass-effect border-b border-zinc-200/50 flex items-center justify-between z-40 sticky top-0">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-2 -ml-1 text-zinc-500 hover:text-primary md:hidden active:scale-90 transition-all"
        >
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
            <span className="text-white font-black text-xs">V</span>
          </div>
          <h1 className="font-bold tracking-tight text-zinc-900 dark:text-white text-[17px] md:text-lg whitespace-nowrap">
            Vectaix AI
          </h1>
        </div>
      </div>
      <div className="md:hidden">
        {/* Placeholder for future mobile actions like share or model quick switch */}
      </div>
    </header>
  );
}
