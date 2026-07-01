import { createSseWriter } from "@/lib/server/chat/sse";

export function createFusionStreamHelpers(controller) {
  const sse = createSseWriter(controller);
  return {
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
  };
}
