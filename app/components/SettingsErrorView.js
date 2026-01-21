"use client";

export default function SettingsErrorView({ settingsError, onLogout }) {
  return (
    <div className="app-root flex font-sans overflow-hidden">
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl p-6 text-center">
          <div className="text-lg font-semibold text-zinc-900">设置数据不兼容</div>
          <div className="mt-2 text-sm text-zinc-600 break-words">
            {settingsError}
          </div>
          <button
            onClick={onLogout}
            className="mt-6 w-full px-4 py-2 rounded-xl bg-zinc-600 hover:bg-zinc-500 text-white text-sm font-medium transition-colors"
            type="button"
          >
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
