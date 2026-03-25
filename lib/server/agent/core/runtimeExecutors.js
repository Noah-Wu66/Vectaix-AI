import path from "path";
import { loadBlobFileByUser } from "@/lib/server/files/service";
import {
  createOrConnectSandbox,
  downloadSandboxArtifactToBlob,
  readSandboxFile,
  runSandboxCommand,
  writeSandboxFile,
} from "@/lib/server/sandbox/vercelSandbox";
import { SearchService } from "@/lib/server/webBrowsing/searchService";
import { WebBrowsingExecutionRuntime } from "@/lib/server/webBrowsing/executionRuntime";
import { WEB_BROWSING_IDENTIFIER, WebBrowsingApiName } from "@/lib/server/webBrowsing/types";
import { ToolRegistry } from "@/lib/server/agent/core/toolRegistry";

export const VERCEL_SANDBOX_IDENTIFIER = "vectaix-vercel-sandbox";
export const VercelSandboxApiName = Object.freeze({
  downloadArtifact: "downloadArtifact",
  exec: "exec",
  readFile: "readFile",
  uploadBlob: "uploadBlob",
});

const TOOL_OUTPUT_CHAR_LIMIT = 6000;

function clipText(text, maxLength = TOOL_OUTPUT_CHAR_LIMIT) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (!Number.isFinite(maxLength) || maxLength <= 0 || trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function pushUniqueCitations(target, items) {
  if (!Array.isArray(target) || !Array.isArray(items)) return;
  for (const item of items) {
    if (!item?.url) continue;
    if (!target.some((citation) => citation.url === item.url)) {
      target.push(item);
    }
  }
}

function buildSearchCitations(state) {
  const citations = [];
  pushUniqueCitations(
    citations,
    Array.isArray(state?.results)
      ? state.results.map((item) => ({
        url: item.url,
        title: item.title || item.url,
        cited_text: item.content || "",
      }))
      : []
  );
  return citations;
}

function buildCrawlCitations(state) {
  const citations = [];
  pushUniqueCitations(
    citations,
    Array.isArray(state?.results)
      ? state.results
        .map((item) => ({
          url: item?.data?.url || item?.originalUrl || "",
          title: item?.data?.title || item?.originalUrl || "",
          cited_text: typeof item?.data?.content === "string" ? clipText(item.data.content, 800) : "",
        }))
        .filter((item) => item.url)
      : []
  );
  return citations;
}

export function createRuntimeExecutors({
  conversationId,
  initialSandboxSession = null,
  userId,
  webSearchOptions,
}) {
  let sandboxSession = initialSandboxSession;

  const registry = new ToolRegistry();
  const webBrowsingRuntime = new WebBrowsingExecutionRuntime({
    searchService: new SearchService({ webSearchOptions }),
  });

  async function ensureSandbox() {
    const ensured = await createOrConnectSandbox({
      userId,
      conversationId,
      existingSession: sandboxSession,
      allowInternetAccess: true,
    });
    sandboxSession = ensured.session;
    return ensured;
  }

  registry.registerBuiltin(WEB_BROWSING_IDENTIFIER, {
    async [WebBrowsingApiName.search](args, options = {}) {
      const result = await webBrowsingRuntime.search(args, options);
      return {
        ...result,
        citations: buildSearchCitations(result?.state),
      };
    },
    async [WebBrowsingApiName.crawlSinglePage](args, options = {}) {
      const result = await webBrowsingRuntime.crawlSinglePage(args, options);
      return {
        ...result,
        citations: buildCrawlCitations(result?.state),
      };
    },
    async [WebBrowsingApiName.crawlMultiPages](args, options = {}) {
      const result = await webBrowsingRuntime.crawlMultiPages(args, options);
      return {
        ...result,
        citations: buildCrawlCitations(result?.state),
      };
    },
  });

  registry.registerBuiltin(VERCEL_SANDBOX_IDENTIFIER, {
    async [VercelSandboxApiName.exec](args, { signal } = {}) {
      const command = typeof args?.command === "string" ? args.command.trim() : "";
      if (!command) throw new Error("沙盒命令不能为空");
      if (args?.background === true) {
        throw new Error("当前 Agent 不支持后台命令");
      }

      const { sandbox, session } = await ensureSandbox();
      const cwd = typeof args?.cwd === "string" && args.cwd.trim() ? args.cwd.trim() : session.workdir;
      const executed = await runSandboxCommand({
        sandbox,
        session,
        command,
        cwd,
        signal,
      });
      sandboxSession = {
        ...session,
        latestCommand: executed.result,
      };

      return {
        success: true,
        content: clipText(
          [
            command,
            `退出码：${executed.result?.exitCode ?? "未知"}`,
            executed.result?.stdout || executed.result?.stderr || "",
          ].filter(Boolean).join("\n")
        ),
        state: {
          command: executed.result?.command || command,
          cwd: executed.result?.cwd || cwd,
          exitCode: Number.isFinite(executed.result?.exitCode) ? executed.result.exitCode : null,
          stdout: executed.result?.stdout || "",
          stderr: executed.result?.stderr || "",
        },
      };
    },

    async [VercelSandboxApiName.uploadBlob](args, { signal } = {}) {
      const url = typeof args?.url === "string" ? args.url.trim() : "";
      if (!url) throw new Error("缺少要上传的文件地址");

      const blobFile = await loadBlobFileByUser({ userId, url });
      if (!blobFile) throw new Error("文件不存在或无权限访问");

      const { sandbox, session } = await ensureSandbox();
      const response = await fetch(blobFile.url, { cache: "no-store", signal });
      if (!response.ok) throw new Error("文件下载失败");

      const remotePath = typeof args?.remotePath === "string" && args.remotePath.trim()
        ? args.remotePath.trim()
        : `${session.workdir}/uploads/${blobFile.originalName || "file"}`;

      await writeSandboxFile({
        sandbox,
        remotePath,
        content: Buffer.from(await response.arrayBuffer()),
      });

      return {
        success: true,
        content: `${blobFile.originalName || "文件"} -> ${remotePath}`,
        state: {
          remotePath,
          file: {
            name: blobFile.originalName || "file",
            mimeType: blobFile.mimeType || "",
            size: Number(blobFile.size) || 0,
            url: blobFile.url,
          },
        },
      };
    },

    async [VercelSandboxApiName.readFile](args) {
      const remotePath = typeof args?.path === "string" ? args.path.trim() : "";
      if (!remotePath) throw new Error("缺少要读取的文件路径");

      const { sandbox } = await ensureSandbox();
      const content = await readSandboxFile({ sandbox, remotePath });

      return {
        success: true,
        content: clipText(`${remotePath}\n${content.text || ""}`),
        state: {
          path: remotePath,
          content: clipText(content.text || "", TOOL_OUTPUT_CHAR_LIMIT),
        },
      };
    },

    async [VercelSandboxApiName.downloadArtifact](args) {
      const remotePath = typeof args?.path === "string" ? args.path.trim() : "";
      if (!remotePath) throw new Error("缺少要导出的文件路径");

      const { sandbox } = await ensureSandbox();
      const artifact = await downloadSandboxArtifactToBlob({
        sandbox,
        remotePath,
        userId,
        conversationId,
        title: typeof args?.title === "string" ? args.title.trim() : path.posix.basename(remotePath),
        mimeType: typeof args?.mimeType === "string" ? args.mimeType.trim() : "text/plain",
        extension: typeof args?.extension === "string" ? args.extension.trim() : "txt",
      });

      return {
        success: true,
        content: `${remotePath}\n已导出：${artifact.url}`,
        state: {
          path: remotePath,
          artifact,
        },
        artifacts: [artifact],
      };
    },
  });

  return {
    registry,
    getSandboxSession() {
      return sandboxSession;
    },
  };
}
