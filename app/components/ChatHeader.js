"use client";

import { Menu } from "lucide-react";
import ModeSwitcher from "./ModeSwitcher";

export default function ChatHeader({ onToggleSidebar, model, onModeChange, modelReady }) {
  return (
    <header className="px-4 py-3 glass-effect border-b border-zinc-200/50 dark:border-zinc-700/50 flex items-center justify-between z-40 sticky top-0">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-2 -ml-1 text-zinc-500 hover:text-primary md:hidden active:scale-90 transition-all"
        >
          <Menu size={22} />
        </button>
        <ModeSwitcher
          model={model}
          onModeChange={onModeChange}
          ready={modelReady}
        />
      </div>
    </header>
  );
}
