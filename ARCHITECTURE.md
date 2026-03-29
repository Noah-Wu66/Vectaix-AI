<div align="center">

# Vectaix AI: A Dual-Engine Architecture for Multi-Expert Council and Autonomous Agent Runtime

**Vectaix AI Team**

</div>

---

## Abstract

We present the technical architecture of **Vectaix AI**, an open-source AI workspace built on a dual-engine design. The system integrates two core modules: (1) the **Council Workflow**, a multi-expert consensus mechanism that dispatches queries to three frontier LLMs in parallel and synthesizes their outputs via a fourth model, and (2) the **Agent Runtime**, a ReAct-style autonomous orchestration layer with tool invocation, state serialization, and multi-step planning. Both engines are deployed entirely on Vercel's serverless infrastructure (Next.js 16, App Router) and communicate with the client via custom Server-Sent Events (SSE) protocols.

---

## 1. System Overview

```mermaid
graph TB
    Client["Client (React 19 + SSE)"] -->|POST /api/council| Council["Council Engine"]
    Client -->|POST /api/agent| Agent["Agent Engine"]

    subgraph CouncilEngine["Council Engine"]
        direction TB
        CT["Seed Triage"] --> EX["Parallel Experts (×3)"]
        EX --> SS["Seed Synthesis"]
    end

    subgraph AgentEngine["Agent Engine"]
        direction TB
        PL["Planner"] --> RD["Attachment Reader"]
        RD --> TL["Tool Loop (ReAct)"]
        TL --> WR["Answer Writer"]
    end

    Council --> DB[(MongoDB)]
    Agent --> DB
    Agent --> Tools["Tool Registry"]
    Tools --> WB["Web Browsing"]
    Tools --> SB["Vercel Sandbox"]

    style Client fill:#fff,stroke:#333,stroke-width:2px
    style CouncilEngine fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,rx:8
    style AgentEngine fill:#fff3e0,stroke:#e65100,stroke-width:2px,rx:8
    style DB fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style Tools fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
```

<div align="center">
  <em>Figure 1 | System-level architecture. The client communicates with two independent engines via distinct SSE endpoints. Both engines share a MongoDB persistence layer.</em>
</div>

---

## 2. The Council Module

### 2.1 Design

The Council Workflow dispatches a user query to three expert models from different providers, collects their independent responses in parallel, and delegates a fourth model (Seed 2.0 Pro) to synthesize a final consensus. The pipeline consists of three phases: **Triage**, **Parallel Expert Generation**, and **Consensus Synthesis**.

### 2.2 Expert Configuration

The three expert models are defined in `lib/shared/models.js` and called via official APIs:

| Expert | Model ID | Provider | Default Thinking | Max Output Tokens |
|:---|:---|:---|:---:|:---:|
| GPT-5.4 | `gpt-5.4` | OpenAI (Responses API) | `high` | 4,000 |
| Claude Opus 4.6 | `claude-opus-4-6` | Anthropic (Messages API) | `max` | 4,000 |
| Gemini 3.1 Pro Preview | `gemini-3.1-pro-preview` | Google (GenAI SDK) | `HIGH` | 4,000 |

The synthesis model is **Seed 2.0 Pro** (`doubao-seed-2-0-pro-260215`) from ByteDance, accessed via the ARK API endpoint (`https://ark.cn-beijing.volces.com/api/v3/responses`), with `thinkingLevel: "high"` and `maxTokens: 8000`.

### 2.3 Pipeline Architecture

```mermaid
graph TB
    Q["User Query Q"] --> TR

    subgraph Phase1["Phase 1 · Seed Triage"]
        TR["Seed 2.0 Pro<br/>──────────<br/>thinkingLevel: minimal<br/>temperature: 0.3<br/>maxTokens: 1200<br/>──────────<br/>Output: JSON<br/>{needCouncil, directAnswer}"]
    end

    TR -->|"needCouncil = false"| DA["Direct Answer<br/>(simulated streaming)"]
    TR -->|"needCouncil = true"| PAR

    subgraph Phase2["Phase 2 · Parallel Expert Generation (Promise.all)"]
        direction LR
        PAR[" "] --> E1
        PAR --> E2
        PAR --> E3

        E1["GPT-5.4<br/>──────────<br/>1. Web Search<br/>2. Chain-of-Thought<br/>3. Response R₁"]
        E2["Claude Opus 4.6<br/>──────────<br/>1. Web Search<br/>2. Chain-of-Thought<br/>3. Response R₂"]
        E3["Gemini 3.1 Pro<br/>──────────<br/>1. Web Search<br/>2. Chain-of-Thought<br/>3. Response R₃"]
    end

    E1 --> AGG
    E2 --> AGG
    E3 --> AGG

    subgraph Phase3["Phase 3 · Seed Consensus Synthesis (Streaming)"]
        AGG["Build Payload<br/>──────────<br/>History Memo<br/>+ User Prompt<br/>+ R₁ + R₂ + R₃<br/>+ All Citations"] --> SEED["Seed 2.0 Pro<br/>──────────<br/>thinkingLevel: high<br/>temperature: 1<br/>maxTokens: 8000<br/>──────────<br/>4-Section Output:<br/>① Consensus Table<br/>② Disagreement Table<br/>③ Unique Findings<br/>④ Comprehensive Analysis"]
    end

    SEED --> OUT["Consensus Response A"]

    style Phase1 fill:#fff8e1,stroke:#f9a825,stroke-width:2px,rx:8
    style Phase2 fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,rx:8
    style Phase3 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,rx:8
    style Q fill:#fff,stroke:#333,stroke-width:2px
    style DA fill:#fce4ec,stroke:#c62828,stroke-width:1px
    style OUT fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
```

<div align="center">
  <em>Figure 2 | Council pipeline. Phase 1 uses Seed as a lightweight triage classifier. If the query is non-trivial, Phase 2 dispatches all three experts in parallel via <code>Promise.all</code>, each independently performing web search and reasoning. Phase 3 streams the final synthesis through Seed with a structured 4-section output format.</em>
</div>

### 2.4 Triage Bypass Conditions

The triage step determines whether a full Council deliberation is necessary. It is bypassed entirely when the query contains images or is a regeneration request. For text-only queries, a two-stage filter applies:

1. **Client-side regex**: matches greetings (`你好`, `Hi`, `谢谢`) or ultra-short queries (≤18 chars, single clause, ≤4 Latin tokens, no complex keywords).
2. **Server-side Seed call**: `thinkingLevel: "minimal"`, `temperature: 0.3`, outputs `{"needCouncil": true/false, "directAnswer": "..."}`.

Only when both stages agree that the query is trivial does the system skip expert consultation and stream the `directAnswer` directly.

### 2.5 Synthesis Output Format

The Seed synthesis model receives a system prompt with 16 mandatory rules and outputs a fixed 4-section structure:

| Section | Format | Content |
|:---|:---|:---|
| Model Consensus | Table: `Finding \| GPT \| Claude \| Gemini \| Evidence` | Points where all experts agree |
| Model Disagreement | Table: `Topic \| GPT \| Claude \| Gemini \| Reason` | Points where experts diverge |
| Unique Findings | Table: `Model \| Finding \| Importance` | Insights from only one expert |
| Comprehensive Analysis | Free text | Direct answer integrating all evidence |

### 2.6 SSE Event Protocol (Council)

The Council engine uses a custom SSE protocol with the following event types:

| Event | Payload | Trigger |
|:---|:---|:---|
| `council_expert_states` | `[{key, label, phase, thinkingLevel}]` | Stream initialization |
| `council_expert_state` | `{key, phase, ...}` | Expert state transition |
| `council_expert_result` | `{key, content, thinkingContent, citations}` | Expert completion |
| `council_summary_state` | `{phase}` | Synthesis state transition |
| `text` | `{text}` | Synthesis streaming delta |
| `council_triage` | `{directAnswer}` | Triage bypass |
| `citations` | `[{title, url}]` | Final citation list |
| `[DONE]` | — | Stream termination |

Expert phase transitions: `pending → searching → thinking → done | error`

Synthesis phase transitions: `pending → thinking → answering → done`

### 2.7 Context Window Utilization

Each expert operates independently with its own context window. The chart below shows the maximum context capacity of each model in the Council pipeline:

```mermaid
xychart-beta
    title "Context Window Size by Model (tokens)"
    x-axis ["Gemini 3.1 Pro", "GPT-5.4", "Seed 2.0 Pro", "Claude Opus 4.6", "DeepSeek V3.2"]
    y-axis "Context (K tokens)" 0 --> 1100
    bar [1048, 272, 256, 200, 128]
```

<div align="center">
  <em>Figure 3 | Context window sizes across all supported models. Gemini 3.1 Pro leads with ~1M tokens. These values are sourced from <code>lib/shared/models.js</code>.</em>
</div>

### 2.8 Token Budget Allocation

The Council pipeline enforces strict token budgets at each stage:

```mermaid
xychart-beta
    title "Token Budget Allocation in Council Pipeline"
    x-axis ["Triage (Seed)", "Expert (×3)", "Synthesis (Seed)", "Expert Raw MD"]
    y-axis "Max Tokens / Chars" 0 --> 22000
    bar [1200, 4000, 8000, 20000]
```

<div align="center">
  <em>Figure 4 | Token and character budgets. Triage is capped at 1,200 tokens. Each expert produces up to 4,000 tokens. Synthesis allows up to 8,000 tokens. Expert raw markdown is truncated at 20,000 characters before being passed to the synthesis model.</em>
</div>

---

## 3. The Agent Module

### 3.1 Formal Definition

The Agent Runtime is formalized as a tuple $\mathcal{A} = \langle \mathcal{I}, \mathcal{T}, \mathcal{M}, \mathcal{S} \rangle$ with the following concrete implementations:

| Symbol | Component | Implementation |
|:---:|:---|:---|
| $\mathcal{I}$ | Instruction Engine | `instructionEngine.js` — 4-phase pipeline (Plan → Read → Tool Loop → Write) |
| $\mathcal{T}$ | Tool Registry | `toolRegistry.js` — `Map<identifier, executor>` with 2 identifiers, 7 APIs |
| $\mathcal{M}$ | Orchestrator | `coordinator.js` — Central state manager + SSE event bus |
| $\mathcal{S}$ | State Serializer | `stateSerializer.js` — Safe serialization with depth/size limits |

<div align="center">
  <em>Table 1 | Agent module components mapped to source files.</em>
</div>

### 3.2 Execution Pipeline

The Agent operates in a 4-phase pipeline. Each phase is managed by the Coordinator, which broadcasts state transitions as SSE events.

```mermaid
graph TB
    IN["POST /api/agent"] --> AUTH["Auth + Rate Limit<br/>(20 req/min)"]
    AUTH --> RT["runAgentRuntime"]
    RT --> COORD["Coordinator.init()"]

    subgraph IE["Instruction Engine — 4 Phases"]
        direction TB

        subgraph P1["Phase 1 · Planner (Regex-based, no LLM)"]
            PLAN["Keyword Matching<br/>──────────<br/>shouldSearch: 搜索/最新/官网...<br/>shouldUseMemory: 继续/上次...<br/>shouldUseSandbox: 代码/运行...<br/>shouldReadAttachments: has files"]
        end

        subgraph P2["Phase 2 · Attachment Reader"]
            READ["For each attachment:<br/>prepareDocumentAttachment()<br/>──────────<br/>Text/Code → direct read<br/>PDF/DOCX/XLSX → Vercel Sandbox<br/>(Python 3.13, network: deny-all)"]
        end

        subgraph P3["Phase 3 · Tool Loop (ReAct, max 4 rounds)"]
            CTRL["runAgentControlText<br/>──────────<br/>Non-streaming LLM call<br/>maxTokens: 900<br/>temperature: 0.1"] --> PARSE["normalizeInstruction<br/>──────────<br/>Parse JSON response"]
            PARSE -->|"call_tool"| EXEC["ToolRegistry.execute()<br/>──────────<br/>Whitelist validation<br/>→ invoke tool API"]
            EXEC --> RES["Collect result<br/>→ append to toolResults"]
            RES -->|"round < 4"| CTRL
            PARSE -->|"finish"| EXIT["Exit loop"]
        end

        subgraph P4["Phase 4 · Answer Writer"]
            WRITE["buildFinalPrompt<br/>──────────<br/>Goal + Plan + Memory<br/>+ Attachments + Search Context<br/>+ Tool Results<br/>──────────<br/>streamAgentFinalAnswer<br/>maxTokens: 32,000<br/>Streaming with thinking"]
        end

        P1 --> P2 --> P3 --> P4
    end

    COORD --> IE
    P4 --> MEM["appendMemoryEntry<br/>(MongoDB, max 5 recent)"]
    P4 --> SER["serializeRuntimeState<br/>→ persist to Conversation"]

    style IE fill:#fff8e1,stroke:#f57f17,stroke-width:2px,rx:8
    style P1 fill:#e8f5e9,stroke:#2e7d32,stroke-width:1px,rx:6
    style P2 fill:#e3f2fd,stroke:#1565c0,stroke-width:1px,rx:6
    style P3 fill:#fce4ec,stroke:#c62828,stroke-width:1px,rx:6
    style P4 fill:#f3e5f5,stroke:#7b1fa2,stroke-width:1px,rx:6
```

<div align="center">
  <em>Figure 5 | Agent execution pipeline. Phase 1 uses regex-based keyword matching (no LLM call) to determine which capabilities to enable. Phase 3 implements a ReAct-style tool loop where the LLM outputs structured JSON instructions. Phase 4 streams the final answer with full context injection.</em>
</div>

### 3.3 Tool Registry

The Agent has access to **2 tool identifiers** with a total of **7 API endpoints**:

| Identifier | API Name | Function |
|:---|:---|:---|
| `lobe-web-browsing` | `search` | Web search via Volcengine API (max 20 results) |
| `lobe-web-browsing` | `crawlSinglePage` | Fetch and extract content from a single URL |
| `lobe-web-browsing` | `crawlMultiPages` | Batch fetch multiple URLs (3 concurrent, 20s timeout) |
| `vectaix-vercel-sandbox` | `exec` | Execute commands in Vercel Sandbox (Node 24 / Python 3.13) |
| `vectaix-vercel-sandbox` | `uploadBlob` | Upload user files into the sandbox filesystem |
| `vectaix-vercel-sandbox` | `readFile` | Read files from the sandbox |
| `vectaix-vercel-sandbox` | `downloadArtifact` | Export sandbox artifacts to Vercel Blob storage |

<div align="center">
  <em>Table 2 | Complete tool registry. All tool calls are validated against a strict whitelist of known identifier + apiName combinations before execution.</em>
</div>

### 3.4 LLM Interaction Modes

The Agent communicates with the LLM in two distinct modes:

| Mode | Purpose | Streaming | Max Tokens | Temperature |
|:---|:---|:---:|:---:|:---:|
| **Control** (`runAgentControlText`) | Tool loop JSON instructions | No | 900 | 0.1 |
| **Answer** (`streamAgentFinalAnswer`) | Final user-visible response | Yes | 32,000 | Model default |

Both modes support all non-Council models: GPT-5.4, Claude Opus 4.6, Gemini 3.1 Pro, DeepSeek V3.2, Seed 2.0 Pro, MiMo, MiniMax M2.5.

### 3.5 SSE Event Protocol (Agent)

| Event | Trigger |
|:---|:---|
| `agent_runtime_init` | Runtime starts |
| `step_start` / `step_complete` | Phase transitions (Planner, Reader, Tool Loop, Writer) |
| `tool_start` / `tool_end` | Tool invocation begin/end |
| `stream_start` / `stream_chunk` / `stream_end` | Streaming channels (`reasoning`, `answer`) |
| `error` | Any unrecoverable error |
| `agent_runtime_end` | Runtime completes |

### 3.6 State Serialization Safety Limits

The State Serializer (`stateSerializer.js`) enforces the following constraints before persisting to MongoDB:

```mermaid
xychart-beta
    title "State Serialization Safety Limits"
    x-axis ["Timeline Content", "Tool Summary", "Max Tools", "Max Artifacts", "Max Citations", "JSON Depth", "Array Items", "Object Keys"]
    y-axis "Limit" 0 --> 20010
    bar [20000, 4000, 20, 20, 20, 4, 12, 20]
```

<div align="center">
  <em>Figure 6 | State serialization constraints. Timeline content entries are capped at 20,000 characters each. Tool summaries at 4,000. Nested JSON is sanitized to a maximum depth of 4 levels, arrays are truncated to 12 items, and objects to 20 keys.</em>
</div>

---

## 4. Supported Models

| Model | Provider | Model ID | Context | Images | Thinking Levels |
|:---|:---|:---|:---:|:---:|:---|
| **GPT-5.4** | OpenAI | `gpt-5.4` | 272K | Yes | none / low / medium / high / xhigh |
| **Claude Opus 4.6** | Anthropic | `claude-opus-4-6` | 200K | Yes | low / medium / high / max |
| **Gemini 3.1 Pro Preview** | Google | `gemini-3.1-pro-preview` | 1,048K | Yes | LOW / MEDIUM / HIGH |
| **DeepSeek V3.2** | DeepSeek | `deepseek-reasoner` | 128K | No | (fixed: medium) |
| **Seed 2.0 Pro** | ByteDance | `doubao-seed-2-0-pro-260215` | 256K | Yes | minimal / low / medium / high |
| **MiMo** | Xiaomi | `xiaomi/mimo-v2-flash` | 65K | No | — |
| **MiniMax M2.5** | MiniMax | `minimax/minimax-m2.5` | 204K | No | — (has toolUse) |
| **Council** | Composite | `council` | — | Yes | — |

<div align="center">
  <em>Table 3 | Complete model registry from <code>lib/shared/models.js</code>. Default model is <code>deepseek-reasoner</code>. Council mode composes GPT-5.4 + Claude Opus 4.6 + Gemini 3.1 Pro + Seed 2.0 Pro.</em>
</div>

---

## 5. Web Browsing System

The web browsing subsystem is itself a **mini agent loop** (up to 5 rounds) orchestrated by `session.js`. The LLM decides which browsing actions to take at each step.

```mermaid
graph LR
    subgraph BrowsingLoop["Web Browsing Session (max 5 rounds)"]
        direction TB
        LLM["LLM Action Decision<br/>(via actionRunner)"] --> |"search"| WS["Volcengine Search<br/>──────────<br/>Max 20 results<br/>5 QPS rate limit<br/>3× retry with backoff"]
        LLM --> |"crawlSinglePage"| CS["Fetch Single URL<br/>──────────<br/>UA: Vectaix-AI-WebBrowsing/1.0<br/>20s timeout<br/>25K char limit"]
        LLM --> |"crawlMultiPages"| CM["Batch Fetch URLs<br/>──────────<br/>3 concurrent<br/>Same limits"]
        LLM --> |"final_answer"| FA["Exit Loop"]
        WS --> LLM
        CS --> LLM
        CM --> LLM
    end

    style BrowsingLoop fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,rx:8
```

<div align="center">
  <em>Figure 7 | Web browsing session loop. The Volcengine API supports <code>web</code>, <code>web_summary</code>, and <code>image</code> search types with time range, site, and industry filtering.</em>
</div>

---

## 6. Implementation Stack

| Layer | Technology | Version |
|:---|:---|:---:|
| Framework | Next.js (App Router) | 16.1.1 |
| Runtime | Node.js | 24.x |
| Frontend | React + Tailwind CSS + Ant Design + Framer Motion | 19.2.4 / 3.4 / 5.29 / 11 |
| Database | MongoDB (Mongoose) | 8.x |
| Auth | JWT via jose + bcryptjs + HttpOnly Cookie | 5.2 |
| File Storage | Vercel Blob | 0.19 |
| Sandbox | @vercel/sandbox (Node 24 + Python 3.13) | 0.0.18 |
| AI SDKs | @anthropic-ai/sdk + Gemini REST + OpenAI REST | 0.53 |
| Rendering | react-markdown + remark-gfm + remark-math + rehype-katex | 9.x |
| Deployment | Vercel Pro (Serverless) | — |

<div align="center">
  <em>Table 4 | Technology stack with actual versions from <code>package.json</code>.</em>
</div>

### Rate Limits

| Endpoint | Limit | Window |
|:---|:---:|:---|
| `/api/agent` | 20 | 1 min / user+IP |
| `/api/council` | 30 | 1 min / user+IP |
| `/api/auth/login` | 5 | 1 min / IP |
| `/api/auth/register` | 3 | 10 min / IP |
| `/api/upload` | 30 | 10 min / user+IP |
| `/api/chat/compress` | 10 | 1 min / user+IP |

<div align="center">
  <em>Table 5 | Rate limits enforced by the in-memory rate limiter (<code>lib/rateLimit.js</code>).</em>
</div>

### Environment Variables

| Variable | Required | Description |
|:---|:---:|:---|
| `MONGO_URI` | ✅ | MongoDB connection string |
| `JWT_SECRET` | ✅ | JWT signing secret (HS256) |
| `OPENAI_API_KEY` | ✅ | OpenAI official API |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic official API |
| `GEMINI_API_KEY` | ✅ | Google Gemini official API |
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek official API |
| `ARK_API_KEY` | ✅ | ByteDance Seed (ARK endpoint) |
| `MINIMAX_API_KEY` | ✅ | MiniMax official API |
| `MIMO_API_BASE_URL` | ✅ | MiMo deployment base URL |
| `MIMO_API_KEY` | ❌ | MiMo API key |
| `VOLCENGINE_WEB_SEARCH_API_KEY` | ⬚ | Volcengine web search |
| `ADMIN_EMAILS` | ❌ | Comma-separated admin email list |

---

## 7. Error Handling & Rollback

Both engines implement conversation-level rollback on failure:

- **New conversation**: entire conversation document is deleted.
- **Regeneration**: original message list is restored.
- **Appended message**: the user message is removed via `$pull`.

The Agent Coordinator's `fail()` method closes all active streams and emits an `error` event before the API route initiates rollback.

---

<div align="center">
  <em>Built with passion. Powered by open-source methodologies.</em>
</div>