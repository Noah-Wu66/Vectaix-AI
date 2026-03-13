import crypto from "crypto";
import { put } from "@vercel/blob";
import AgentRun from "@/models/AgentRun";
import BlobFile from "@/models/BlobFile";

export const AGENT_EXECUTION_STATES = Object.freeze({
  planning: "planning",
  awaitingApproval: "awaiting_approval",
  running: "running",
  waitingContinue: "waiting_continue",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
});

export const AGENT_STEP_SEQUENCE = Object.freeze([
  "plan",
  "memory",
  "sandbox_prepare",
  "attachment_prepare",
  "attachment_read",
  "search_decide",
  "search_run",
  "tool_loop",
  "finalize",
]);

export const AGENT_LEASE_TTL_MS = 90 * 1000;
export const AGENT_STALE_RUN_MS = 8 * 60 * 1000;

export function generateResumeToken() {
  return crypto.randomUUID();
}

export function buildAgentMessageMeta(run, extra = {}) {
  const approvalRequest = run?.approvalRequest || null;
  const currentStep = typeof run?.currentStep === "string" ? run.currentStep : "";
  const publicSteps = Array.isArray(run?.steps)
    ? run.steps.map((step) => ({
        type: step?.type || "",
        title: step?.title || "",
        status: step?.status || "pending",
        toolName: step?.toolName || null,
      }))
    : [];

  return {
    runId: run?._id?.toString?.() || "",
    status: run?.status || "running",
    executionState: run?.executionState || AGENT_EXECUTION_STATES.running,
    currentStep,
    currentCursor: Number.isFinite(run?.currentCursor) ? run.currentCursor : 0,
    canResume: run?.status === "waiting_continue" || extra.canResume === true,
    lastError: run?.lastError || "",
    failureReason: run?.failureReason || "",
    approvalReason: approvalRequest?.reason || "",
    approvalStatus: approvalRequest?.status || "",
    attemptCount: Number.isFinite(run?.attemptCount) ? run.attemptCount : 0,
    steps: publicSteps,
    artifacts: Array.isArray(run?.artifacts) ? run.artifacts : [],
    citations: Array.isArray(run?.citations) ? run.citations : [],
    sandboxSession: run?.sandboxSession || null,
    updatedAt: run?.updatedAt ? new Date(run.updatedAt).toISOString() : null,
    resumeToken: typeof run?.resumeToken === "string" ? run.resumeToken : "",
    ...extra,
  };
}

export async function acquireRunLease(runId, owner) {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AGENT_LEASE_TTL_MS);
  const run = await AgentRun.findOneAndUpdate(
    {
      _id: runId,
      $or: [
        { lease: null },
        { "lease.expiresAt": { $lte: now } },
      ],
    },
    {
      $set: {
        lease: {
          owner,
          token,
          acquiredAt: now,
          expiresAt,
        },
        lastHeartbeatAt: now,
        updatedAt: now,
      },
    },
    { new: true }
  );

  if (!run) {
    throw new Error("当前任务正在执行中，请稍后再试");
  }

  return { run, leaseToken: token, expiresAt };
}

export async function renewRunLease(runId, owner, leaseToken) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AGENT_LEASE_TTL_MS);
  return AgentRun.findOneAndUpdate(
    {
      _id: runId,
      "lease.owner": owner,
      "lease.token": leaseToken,
    },
    {
      $set: {
        "lease.expiresAt": expiresAt,
        lastHeartbeatAt: now,
        updatedAt: now,
      },
    },
    { new: true }
  );
}

export async function releaseRunLease(runId, owner, leaseToken) {
  return AgentRun.findOneAndUpdate(
    {
      _id: runId,
      "lease.owner": owner,
      "lease.token": leaseToken,
    },
    {
      $set: {
        lease: null,
        updatedAt: new Date(),
      },
    },
    { new: true }
  );
}

export function pickPendingStepIndex(run) {
  const cursor = Number.isFinite(run?.currentCursor) ? run.currentCursor : 0;
  if (cursor < 0) return 0;
  if (cursor >= AGENT_STEP_SEQUENCE.length) return AGENT_STEP_SEQUENCE.length;
  return cursor;
}

export function buildStepResult(stepType, payload = {}) {
  return {
    stepType,
    updatedAt: new Date(),
    ...payload,
  };
}

export async function saveTextArtifact({
  userId,
  conversationId,
  runId,
  title,
  text,
  extension = "md",
  mimeType = "text/markdown",
}) {
  if (typeof text !== "string" || !text.trim()) return null;

  const safeTitle = typeof title === "string" && title.trim() ? title.trim() : "agent-result";
  const pathname = `agent/${userId}/${conversationId}/${runId}/${safeTitle}.${extension}`;
  const blob = await put(pathname, text, {
    access: "public",
    addRandomSuffix: true,
    contentType: mimeType,
  });

  await BlobFile.findOneAndUpdate(
    { url: blob.url },
    {
      $setOnInsert: {
        userId,
        url: blob.url,
        pathname: blob.pathname,
        originalName: `${safeTitle}.${extension}`,
        mimeType,
        size: Buffer.byteLength(text, "utf8"),
        extension,
        category: "text",
        kind: "agent-artifact",
        parseStatus: "ready",
        extractedText: text,
        extractedChars: text.length,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  return {
    url: blob.url,
    pathname: blob.pathname,
    title: safeTitle,
    mimeType,
    extension,
    size: Buffer.byteLength(text, "utf8"),
  };
}

export function isRunStale(run) {
  const lastHeartbeatAt = run?.lastHeartbeatAt ? new Date(run.lastHeartbeatAt).getTime() : 0;
  if (!lastHeartbeatAt) return false;
  return Date.now() - lastHeartbeatAt >= AGENT_STALE_RUN_MS;
}
