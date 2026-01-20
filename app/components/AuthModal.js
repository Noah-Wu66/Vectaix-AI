"use client";

import { Sparkles } from "lucide-react";

export default function AuthModal({
  authMode,
  email,
  password,
  confirmPassword,
  authError,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
  onToggleMode,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-zinc-500 flex items-center justify-center">
            <Sparkles size={24} className="text-white" />
          </div>
        </div>
        <h2 className="text-xl font-semibold text-center mb-1 text-zinc-900">
          {authMode === "login" ? "欢迎回来" : "创建账号"}
        </h2>
        <p className="text-center text-zinc-500 mb-8 text-sm">
          登录以继续使用 Vectaix AI
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 transition-colors"
            required
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 transition-colors"
            required
          />
          {authMode === "register" && (
            <input
              type="password"
              placeholder="确认密码"
              value={confirmPassword}
              onChange={(e) => onConfirmPasswordChange(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 transition-colors"
              required
            />
          )}
          {authError && (
            <p className="text-sm text-red-500 text-center py-1">{authError}</p>
          )}
          <button className="w-full bg-zinc-600 hover:bg-zinc-500 text-white font-medium py-3 rounded-lg transition-colors">
            {authMode === "login" ? "登录" : "注册"}
          </button>

          {authMode === "login" && (
            <button
              type="button"
              onClick={() => {
                window.location.href = "/enterprise-login";
              }}
              className="w-full border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-900 font-medium py-3 rounded-lg transition-colors"
            >
              企业登录
            </button>
          )}
        </form>

        <p className="text-center mt-6 text-zinc-500 text-sm">
          {authMode === "login" ? "还没有账号？" : "已有账号？"}
          <button
            onClick={onToggleMode}
            className="text-zinc-900 hover:underline font-medium ml-1"
            type="button"
          >
            {authMode === "login" ? "立即注册" : "立即登录"}
          </button>
        </p>
      </div>
    </div>
  );
}


