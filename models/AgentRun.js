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
  status: {
    type: String,
    required: true,
    default: "running",
    index: true,
  },
  currentStep: {
    type: String,
    default: "",
  },
  steps: {
    type: [AgentStepSchema],
    default: [],
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

export default mongoose.models.AgentRun || mongoose.model("AgentRun", AgentRunSchema);
