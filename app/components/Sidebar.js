"use client";

import { LogOut, Plus, Trash2, X } from "lucide-react";

export default function Sidebar({
  isOpen,
  conversations,
  currentConversationId,
  user,
  onStartNewChat,
  onLoadConversation,
  onDeleteConversation,
  onOpenProfile,
  onLogout,
  onClose,
}) {
  return (
    <div
      className={`fixed md:relative z-30 w-64 h-full bg-zinc-50 border-r border-zinc-200 flex-col ${
        isOpen ? "flex" : "hidden md:flex"
      }`}
    >
      <div className="p-4 border-b border-zinc-200 flex items-center justify-between">
        <button
          onClick={onStartNewChat}
          className="flex-1 flex items-center gap-2 bg-white hover:bg-zinc-100 border border-zinc-200 text-zinc-700 p-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> 新对话
        </button>
        <button onClick={onClose} className="md:hidden p-2 text-zinc-400 ml-2">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
        {conversations.map((conv) => (
          <div
            key={conv._id}
            className={`group flex items-center gap-1 rounded-lg transition-colors ${
              currentConversationId === conv._id
                ? "bg-white border border-zinc-200"
                : "hover:bg-white"
            }`}
          >
            <button
              onClick={() => onLoadConversation(conv._id)}
              className={`flex-1 text-left p-3 text-sm truncate ${
                currentConversationId === conv._id
                  ? "text-zinc-900 font-medium"
                  : "text-zinc-600"
              }`}
            >
              {conv.title}
            </button>
            <button
              onClick={(e) => onDeleteConversation(conv._id, e)}
              className="p-2 mr-1 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-zinc-200">
        <div className="flex items-center justify-between">
          <button
            onClick={onOpenProfile}
            className="flex items-center gap-2 flex-1 hover:bg-white p-2 rounded-lg transition-colors -ml-2 text-left mr-2"
          >
            <div className="w-8 h-8 rounded-lg bg-zinc-500 flex items-center justify-center text-xs font-semibold text-white">
              {user?.email?.[0]?.toUpperCase?.() ?? "?"}
            </div>
            <div className="text-xs truncate max-w-[100px] text-zinc-600 font-medium">
              {user?.email}
            </div>
          </button>
          <button
            onClick={onLogout}
            className="text-zinc-400 hover:text-red-500 transition-colors p-2"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}


