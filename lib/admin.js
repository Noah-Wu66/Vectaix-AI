import { getAuthPayload } from './auth';

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

/**
 * 验证当前请求用户是否为管理员
 * 返回 { payload, isAdmin } 或 null（未登录）
 */
export async function requireAdmin() {
  const payload = await getAuthPayload();
  if (!payload) return null;
  if (!isAdminEmail(payload.email)) return null;
  return payload;
}
