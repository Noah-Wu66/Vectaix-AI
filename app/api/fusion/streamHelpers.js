import { createSseWriter } from "@/lib/server/chat/sse";

export function createFusionStreamHelpers(controller) {
  const sse = createSseWriter(controller);
  return {
    sendEvent(payload) {
      sse.send(payload);
    },
    sendText(content) {
      if (!content) return;
      sse.send({ type: "text", content });
    },
    sendFusionExpertStates(experts) {
      sse.send({ type: "fusion_expert_states", experts });
    },
    sendFusionExpertState(expert) {
      sse.send({ type: "fusion_expert_state", expert });
    },
    sendFusionAnalysisState(analysis) {
      sse.send({ type: "fusion_analysis_state", analysis });
    },
    sendFusionExperts(experts) {
      sse.send({
        type: "fusion_experts",
        experts: experts.map((expert) => ({
          modelId: expert.modelId,
          label: expert.label,
          content: expert.rawMarkdown,
          citations: expert.citations,
          durationMs: expert.durationMs,
        })),
      });
    },
    sendFusionExpertResult(expert) {
      sse.send({
        type: "fusion_expert_result",
        expert: {
          modelId: expert.modelId,
          label: expert.label,
          content: expert.rawMarkdown,
          citations: expert.citations,
          durationMs: expert.durationMs,
        },
      });
    },
    sendFusionAnalysisResult(analysis) {
      sse.send({ type: "fusion_analysis_result", analysis });
    },
    sendFusionResultState(result) {
      sse.send({ type: "fusion_result_state", result });
    },
    sendFusionResult(content) {
      sse.send({ type: "fusion_result", content });
    },
    sendCitations(citations) {
      if (!Array.isArray(citations) || citations.length === 0) return;
      sse.send({ type: "citations", citations });
    },
    sendDone() {
      sse.done();
    },
    sendFusionTriage(payload) {
      sse.send({ type: "fusion_triage", ...payload });
    },
  };
}
