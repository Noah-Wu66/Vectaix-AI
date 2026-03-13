import { Template, defaultBuildLogger } from "e2b";
import { createVectaixTemplate } from "@/scripts/e2b-template/template.mjs";
import {
  assertE2BApiKey,
  getConfiguredE2BTemplateRef,
  getConfiguredE2BTemplateVersion,
} from "@/lib/server/sandbox/e2bConfig";

export async function publishConfiguredE2BTemplate() {
  assertE2BApiKey();

  const templateRef = getConfiguredE2BTemplateRef();
  const template = createVectaixTemplate();

  const buildResult = await Template.build(template, {
    alias: templateRef,
    cpuCount: 1,
    memoryMB: 2048,
    onBuildLogs: defaultBuildLogger(),
  });

  return {
    templateRef,
    templateVersion: getConfiguredE2BTemplateVersion(),
    buildResult,
  };
}
