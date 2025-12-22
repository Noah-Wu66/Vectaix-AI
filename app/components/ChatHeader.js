"use client";

import { Menu, Sparkles } from "lucide-react";

export default function ChatHeader({ onToggleSidebar }) {
  return (
    <header className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between bg-white z-10">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-2 -ml-2 text-zinc-500 hover:text-zinc-700 md:hidden"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-zinc-900" />
          <h1 className="font-semibold text-lg tracking-tight text-zinc-900 hidden md:block">
            Vectaix AI
          </h1>
        </div>
      </div>
    </header>
  );
}


