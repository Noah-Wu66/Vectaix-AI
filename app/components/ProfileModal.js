"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Lock,
  Settings,
  Palette,
  Type,
  Users,
  X,
  Camera,
  Volume2,
  GitBranch,
} from "lucide-react";

import { upload } from "@vercel/blob/client";
import { apiJson } from "@/lib/client/apiClient";
import { MODEL_GROUP_TITLES } from "@/lib/shared/models";
import { useToast } from "./ToastProvider";
import UserManagementModal from "./UserManagementModal";

const EMPTY_MODEL_ROUTES = { openai: "default", opus: "default", gemini: "default" };
const MODEL_ROUTE_LABELS = Object.freeze({
  openai: MODEL_GROUP_TITLES.openai,
  opus: MODEL_GROUP_TITLES.claude,
  gemini: MODEL_GROUP_TITLES.gemini,
});

function normalizeUserModelRoutes(routes) {
  return {
    openai: routes?.openai === "zenmux" ? "zenmux" : "default",
    opus: routes?.opus === "zenmux" ? "zenmux" : "default",
    gemini: routes?.gemini === "native" || routes?.gemini === "zenmux" ? "native" : "default",
  };
}

export default function ProfileModal({
  open,
  onClose,
  user,
  isAdmin,
  themeMode,
  fontSize,
  onThemeModeChange,
  onFontSizeChange,
  completionSoundVolume,
  onCompletionSoundVolumeChange,
  avatar,
  onAvatarChange,
}) {
  const toast = useToast();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [showRouteSelector, setShowRouteSelector] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const [avatarLoading, setAvatarLoading] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeSaving, setRouteSaving] = useState(false);
  const [modelRoutes, setModelRoutes] = useState(EMPTY_MODEL_ROUTES);
  const [savedModelRoutes, setSavedModelRoutes] = useState(EMPTY_MODEL_ROUTES);
  const normalizedVolume = Number.isFinite(Number(completionSoundVolume))
    ? Number(completionSoundVolume)
    : 60;

  const emailInitial = useMemo(() => {
    const c = user?.email?.[0];
    return c ? c.toUpperCase() : "?";
  }, [user?.email]);

  const avatarFileInputRef = useRef(null);
  const canManageUsers = Boolean(isAdmin);
  const canSwitchRoutes = Boolean(user?.canSwitchRoutes || isAdmin);
  const hasRouteChanges =
    modelRoutes.openai !== savedModelRoutes.openai ||
    modelRoutes.opus !== savedModelRoutes.opus ||
    modelRoutes.gemini !== savedModelRoutes.gemini;

  const handleAvatarSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.warning("请选择图片文件");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.warning("图片大小不能超过 5MB");
      return;
    }

    setAvatarLoading(true);
    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        clientPayload: JSON.stringify({ kind: "avatar" }),
      });
      await onAvatarChange?.(blob.url);
      toast.success("头像更新成功");
    } catch (err) {
      toast.error(err?.message);
    } finally {
      setAvatarLoading(false);
      if (avatarFileInputRef.current) avatarFileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (!open || !canSwitchRoutes) return;

    let cancelled = false;

    const fetchRouteConfig = async () => {
      setRouteLoading(true);
      try {
        const routesData = await apiJson("/api/model-routes");

        if (!cancelled) {
          const nextRoutes = normalizeUserModelRoutes(routesData?.routes);
          setModelRoutes(nextRoutes);
          setSavedModelRoutes(nextRoutes);
        }
      } catch (e) {
        if (!cancelled) {
          toast.error(e?.message || "加载线路配置失败");
        }
      } finally {
        if (!cancelled) {
          setRouteLoading(false);
        }
      }
    };

    fetchRouteConfig();
    return () => {
      cancelled = true;
    };
  }, [open, canSwitchRoutes, toast]);

  const setProviderRoute = (provider, route) => {
    setModelRoutes((prev) => ({ ...prev, [provider]: route }));
  };

  const saveModelRoutes = async () => {
    setRouteSaving(true);
    try {
      const data = await apiJson("/api/model-routes", {
        method: "PATCH",
        body: modelRoutes,
      });

      const nextRoutes = normalizeUserModelRoutes(data?.routes);
      setModelRoutes(nextRoutes);
      setSavedModelRoutes(nextRoutes);
      toast.success("线路配置已保存，只影响当前账号");
    } catch (e) {
      toast.error(e?.message || "保存线路配置失败");
    } finally {
      setRouteSaving(false);
    }
  };

  const submitChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      toast.warning("两次输入的新密码不一致");
      return;
    }

    setPwLoading(true);
    try {
      const data = await apiJson("/api/auth/change-password", {
        method: "POST",
        body: { oldPassword, newPassword, confirmNewPassword },
      });
      if (data.success) {
        toast.success("密码修改成功");
        setOldPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
      } else {
        toast.error(data.error);
      }
    } catch (err) {
      toast.error(err?.message || "密码修改失败");
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
            onClick={onClose}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white p-6 md:p-8 rounded-2xl w-full max-w-md shadow-xl border border-zinc-200 relative"
              onClick={(e) => e.stopPropagation()}
            >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600"
            >
              <X size={20} />
            </button>

            <div className="text-center mb-6">
              <input
                type="file"
                ref={avatarFileInputRef}
                onChange={handleAvatarSelect}
                className="hidden"
                accept="image/*"
              />
              <button
                type="button"
                onClick={() => avatarFileInputRef.current?.click()}
                disabled={avatarLoading}
                className="relative w-16 h-16 rounded-xl mx-auto flex items-center justify-center mb-3 overflow-hidden group transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
                title="点击更换头像"
              >
                {avatar ? (
                  <img src={avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-zinc-500 flex items-center justify-center text-xl font-semibold text-white">
                    {emailInitial}
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera size={20} className="text-white" />
                </div>
                {avatarLoading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </button>
              <h2 className="text-lg font-semibold text-zinc-900">
                {user?.email}
              </h2>
              <p className="text-sm text-zinc-500">个人中心</p>
            </div>

            <div className="space-y-3">
              {/* 修改密码 */}
              <button
                onClick={() => setShowChangePassword(!showChangePassword)}
                className="w-full flex items-center justify-between bg-zinc-50 hover:bg-zinc-100 rounded-xl p-4 border border-zinc-100 transition-colors"
              >
                <span className="text-sm font-medium text-zinc-700 flex items-center gap-2">
                  <Lock size={14} /> 修改密码
                </span>
                <ChevronDown
                  size={16}
                  className={`text-zinc-400 transition-transform ${showChangePassword ? "rotate-180" : ""
                    }`}
                />
              </button>

              <AnimatePresence>
                {showChangePassword && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-100">
                      <form onSubmit={submitChangePassword} className="space-y-3">
                        <input
                          type="password"
                          placeholder="当前密码"
                          value={oldPassword}
                          onChange={(e) => setOldPassword(e.target.value)}
                          className="w-full bg-white border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-800 focus:border-zinc-400 outline-none"
                          required
                        />
                        <input
                          type="password"
                          placeholder="新密码"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full bg-white border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-800 focus:border-zinc-400 outline-none"
                          required
                        />
                        <input
                          type="password"
                          placeholder="确认新密码"
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          className="w-full bg-white border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-800 focus:border-zinc-400 outline-none"
                          required
                        />
                        <button
                          type="submit"
                          disabled={pwLoading}
                          className="w-full bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                        >
                          更新密码
                        </button>
                      </form>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 外观设置 */}
              <button
                onClick={() => setShowAppearance(!showAppearance)}
                className="w-full flex items-center justify-between bg-zinc-50 hover:bg-zinc-100 rounded-xl p-4 border border-zinc-100 transition-colors"
              >
                <span className="text-sm font-medium text-zinc-700 flex items-center gap-2">
                  <Settings size={14} /> 系统设置
                </span>
                <ChevronDown
                  size={16}
                  className={`text-zinc-400 transition-transform ${showAppearance ? "rotate-180" : ""
                    }`}
                />
              </button>

              <AnimatePresence>
                {showAppearance && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-100 space-y-4">
                      {/* 主题模式 */}
                      <div>
                        <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block flex items-center gap-1">
                          <Palette size={12} /> 主题模式
                        </label>
                        <div className="flex gap-2">
                          {[
                            { id: "light", label: "浅色" },
                            { id: "dark", label: "深色" },
                            { id: "system", label: "跟随系统" },
                          ].map((t) => (
                            <button
                              key={t.id}
                              onClick={() => onThemeModeChange(t.id)}
                              type="button"
                              className={`flex-1 py-2 rounded-lg border transition-colors text-sm ${themeMode === t.id
                                ? "bg-zinc-600 text-white border-zinc-600"
                                : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                                }`}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 字体大小 */}
                      <div>
                        <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block flex items-center gap-1">
                          <Type size={12} /> 字体大小
                        </label>
                        <div className="flex gap-2">
                          {[
                            { id: "small", label: "小", size: "text-xs" },
                            { id: "medium", label: "中", size: "text-sm" },
                            { id: "large", label: "大", size: "text-base" },
                          ].map((f) => (
                            <button
                              key={f.id}
                              onClick={() => onFontSizeChange(f.id)}
                              type="button"
                              className={`flex-1 py-2 rounded-lg border transition-colors ${fontSize === f.id
                                ? "bg-zinc-600 text-white border-zinc-600"
                                : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                                } ${f.size}`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 提示音音量 */}
                      <div>
                        <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block flex items-center gap-1">
                          <Volume2 size={12} /> 提示音音量
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={normalizedVolume}
                            onChange={(e) => onCompletionSoundVolumeChange?.(Number(e.target.value))}
                            className="w-full"
                          />
                          <span className="text-xs text-zinc-500 w-12 text-right">
                            {normalizedVolume <= 0 ? "关闭" : `${normalizedVolume}%`}
                          </span>
                         </div>
                      </div>

                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 线路选择（仅高级用户和超级管理员可见） */}
              {canSwitchRoutes && (
                <>
                  <button
                    onClick={() => setShowRouteSelector(!showRouteSelector)}
                    className="w-full flex items-center justify-between bg-zinc-50 hover:bg-zinc-100 rounded-xl p-4 border border-zinc-100 transition-colors"
                  >
                    <span className="text-sm font-medium text-zinc-700 flex items-center gap-2">
                      <GitBranch size={14} /> 线路选择
                    </span>
                    <ChevronDown
                      size={16}
                      className={`text-zinc-400 transition-transform ${showRouteSelector ? "rotate-180" : ""}`}
                    />
                  </button>

                  <AnimatePresence>
                    {showRouteSelector && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-100 space-y-4">
                          <div className="space-y-2">
                            <label className="text-xs text-zinc-500 font-medium tracking-wider block">{MODEL_ROUTE_LABELS.openai} 线路</label>
                            <div className="flex gap-2">
                              {[
                                { id: "default", label: "AICodeMirror" },
                                { id: "zenmux", label: "Zenmux" },
                              ].map((item) => (
                                <button
                                  key={`openai-${item.id}`}
                                  type="button"
                                  onClick={() => setProviderRoute("openai", item.id)}
                                  disabled={routeLoading || routeSaving}
                                  className={`flex-1 py-2 rounded-lg border transition-colors text-sm ${modelRoutes.openai === item.id
                                    ? "bg-zinc-600 text-white border-zinc-600"
                                    : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                                    } disabled:opacity-50`}
                                >
                                  {item.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs text-zinc-500 font-medium tracking-wider block">{MODEL_ROUTE_LABELS.opus} 线路</label>
                            <div className="flex gap-2">
                              {[
                                { id: "default", label: "AICodeMirror" },
                                { id: "zenmux", label: "Zenmux" },
                              ].map((item) => (
                                <button
                                  key={`opus-${item.id}`}
                                  type="button"
                                  onClick={() => setProviderRoute("opus", item.id)}
                                  disabled={routeLoading || routeSaving}
                                  className={`flex-1 py-2 rounded-lg border transition-colors text-sm ${modelRoutes.opus === item.id
                                    ? "bg-zinc-600 text-white border-zinc-600"
                                    : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                                    } disabled:opacity-50`}
                                >
                                  {item.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs text-zinc-500 font-medium tracking-wider block">{MODEL_ROUTE_LABELS.gemini} 线路</label>
                            <div className="flex gap-2">
                              {[
                                { id: "default", label: "AICodeMirror" },
                                { id: "native", label: "Google 原生" },
                              ].map((item) => (
                                <button
                                  key={`gemini-${item.id}`}
                                  type="button"
                                  onClick={() => setProviderRoute("gemini", item.id)}
                                  disabled={routeLoading || routeSaving}
                                  className={`flex-1 py-2 rounded-lg border transition-colors text-sm ${modelRoutes.gemini === item.id
                                    ? "bg-zinc-600 text-white border-zinc-600"
                                    : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                                    } disabled:opacity-50`}
                                >
                                  {item.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={saveModelRoutes}
                            disabled={routeLoading || routeSaving || !hasRouteChanges}
                            className="w-full bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                          >
                            {routeLoading ? "加载中..." : routeSaving ? "保存中..." : "保存线路配置"}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}

              {/* 用户管理（仅超级管理员可见） */}
              {canManageUsers && (
                <button
                  onClick={() => setShowUserManagement(true)}
                  className="w-full flex items-center justify-between bg-zinc-50 hover:bg-zinc-100 rounded-xl p-4 border border-zinc-100 transition-colors"
                >
                  <span className="text-sm font-medium text-zinc-700 flex items-center gap-2">
                    <Users size={14} /> 用户管理
                  </span>
                  <ChevronDown size={16} className="text-zinc-400" />
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    <UserManagementModal
      open={showUserManagement}
      onClose={() => setShowUserManagement(false)}
    />
  </>
  );
}
