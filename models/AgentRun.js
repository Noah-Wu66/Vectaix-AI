import mongoose from "mongoose";

const AgentStepSchema = new mongoose.Schema(
  {
    stepOrder: { type: Number, required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    status: { type: String, required: true, default: "pending" },
    toolName: { type: String, default: null },
    inputSummary: { type: String, default: "" },
    outputSummary: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { _id: false }
);

const ApprovalRequestSchema = new mongoose.Schema(
  {
    reason: { type: String, default: "" },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    status: { type: String, default: "pending" },
    decidedAt: { type: Date, default: null },
  },
  { _id: false }
);

const LeaseSchema = new mongoose.Schema(
  {
    owner: { type: String, default: "" },
    token: { type: String, default: "" },
    acquiredAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { _id: false }
);

const AgentRunSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Conversation",
    required: true,
    index: true,
  },
  model: {
    type: String,
    required: true,
  },
  goal: {
    type: String,
    required: true,
  },
  runVersion: {
    type: Number,
    default: 2,
  },
  status: {
    type: String,
    required: true,
    default: "running",
    index: true,
  },
  executionState: {
    type: String,
    default: "planning",
    index: true,
  },
  currentStep: {
    type: String,
    default: "",
  },
  currentCursor: {
    type: Number,
    default: 0,
  },
  steps: {
    type: [AgentStepSchema],
    default: [],
  },
  stepResults: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  planSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  contextSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({
      memorySummaries: [],
      preparedAttachments: [],
      attachmentContext: "",
      searchContextText: "",
      searchDecisions: [],
      computeContext: "",
      draftAnswer: "",
    }),
  },
  artifacts: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  citations: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  attemptCount: {
    type: Number,
    default: 0,
  },
  lastHeartbeatAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  lease: {
    type: LeaseSchema,
    default: null,
  },
  resumeToken: {
    type: String,
    default: "",
  },
  failureReason: {
    type: String,
    default: "",
  },
  approvalRequest: {
    type: ApprovalRequestSchema,
    default: null,
  },
  finalAnswer: {
    type: String,
    default: "",
  },
  summary: {
    type: String,
    default: "",
  },
  lastError: {
    type: String,
    default: "",
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  finishedAt: {
    type: Date,
    default: null,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

AgentRunSchema.index({ conversationId: 1, status: 1, updatedAt: -1 });
AgentRunSchema.index({ userId: 1, updatedAt: -1 });
AgentRunSchema.index({ status: 1, executionState: 1, lastHeartbeatAt: 1 });

export default mongoose.models.AgentRun || mongoose.model("AgentRun", AgentRunSchema);
