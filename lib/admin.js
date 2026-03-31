import dbConnect from "@/lib/db";
import User from "@/models/User";
import { getAuthPayload } from './auth';
import { getClientIP } from './rateLimit';

/**
 * 判断邮箱是否为管理员
 * 环境变量 ADMIN_EMAILS 用英文逗号分隔多个管理员邮箱
 */
export function isAdminEmail(email) {
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS || '';
  if (!raw) return false;
  const admins = raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}

export function getUserAccessFlags(user) {
  const isAdmin = isAdminEmail(user?.email);
  const isAdvancedUser = user?.isAdvancedUser === true;
  return {
    isAdmin,
    isAdvancedUser,
    canSwitchRoutes: isAdmin || isAdvancedUser,
  };
}

export async function getCurrentUserWithAccess() {
  const payload = await getAuthPayload();
  if (!payload?.userId) return null;

  await dbConnect();
  const user = await User.findById(payload.userId)
    .select("email isAdvancedUser")
    .lean();
  if (!user) return null;

  return {
    userId: user._id.toString(),
    email: user.email,
    ...getUserAccessFlags(user),
  };
}

/**
 * 验证当前请求用户是否为超级管理员
 * 返回 { payload, isAdmin } 或 null（未登录）
 * @param {Request} [req] - Optional request object for audit logging
 */
export async function requireAdmin(req) {
  const payload = await getAuthPayload();
  if (!payload) return null;
  if (!isAdminEmail(payload.email)) {
    // Audit log: unauthorized admin access attempt
    const ip = req ? getClientIP(req) : 'unknown';
    console.warn(
      `[AUDIT] Admin access denied | email=${payload.email} | ip=${ip} | time=${new Date().toISOString()}`
    );
    return null;
  }
  return payload;
}
