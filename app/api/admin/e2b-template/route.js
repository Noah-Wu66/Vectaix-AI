import { requireAdmin } from "@/lib/admin";
import {
  getConfiguredE2BTemplateRef,
  getConfiguredE2BTemplateVersion,
  hasE2BApiKey,
} from "@/lib/server/sandbox/e2bConfig";
import { publishConfiguredE2BTemplate } from "@/lib/server/sandbox/e2bTemplate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return Response.json({ error: "无权限" }, { status: 403 });
  }

  return Response.json({
    template: getConfiguredE2BTemplateRef(),
    templateVersion: getConfiguredE2BTemplateVersion(),
    hasApiKey: hasE2BApiKey(),
  });
}

export async function POST() {
  const admin = await requireAdmin();
  if (!admin) {
    return Response.json({ error: "无权限" }, { status: 403 });
  }

  try {
    const result = await publishConfiguredE2BTemplate();
    return Response.json({
      success: true,
      template: result.templateRef,
      templateVersion: result.templateVersion,
      publishedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "创建 E2B 模板失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
