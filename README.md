<div align="center">

# 🌌 Vectaix AI

### Open-Source AI Workspace — Dual-Engine Architecture for Multi-Expert Council & Autonomous Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=gold)](https://github.com/Noah-Wu66/Vectaix-AI/stargazers)
[![Deploy with Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Node](https://img.shields.io/badge/Node-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)

<br/>

**English** · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md)

[📄 Read the Technical Architecture Paper](./ARCHITECTURE.md)

<br/>

> ⚠️ **Early Stage Notice** — This project is under active development. Features, APIs, and UI may change frequently. Star the repo to stay tuned!

<br/>

<img src="https://img.shields.io/badge/GPT--5.4-412991?style=flat-square&logo=openai&logoColor=white" alt="GPT-5.4" />
<img src="https://img.shields.io/badge/Claude_Opus_4.6-d97706?style=flat-square&logo=anthropic&logoColor=white" alt="Claude" />
<img src="https://img.shields.io/badge/Gemini_3.1_Pro_Preview-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemini" />
<img src="https://img.shields.io/badge/DeepSeek_V3.2-0A0A0A?style=flat-square&logoColor=white" alt="DeepSeek" />
<img src="https://img.shields.io/badge/Seed_2.0_Pro-FF6A00?style=flat-square&logoColor=white" alt="Seed" />
<img src="https://img.shields.io/badge/MiniMax_M2.5-D01D24?style=flat-square&logoColor=white" alt="MiniMax" />

</div>

---

## ✨ What is Vectaix AI?

Vectaix AI is an **open-source AI workspace** designed for cloud-native deployment on Vercel. It brings together the world's leading AI models under one unified interface, powered by a rigorous [Dual-Engine Architecture](./ARCHITECTURE.md). 

Whether you need a quick answer from DeepSeek V3.2, deep reasoning from Claude Opus 4.6, or want multiple AI experts to debate and synthesize a final response, Vectaix AI delivers a highly polished and professional experience.

### 🖼️ Interface Preview

*(Insert a screenshot or GIF of the chat interface here)*

---

## 🎯 Key Features

<table>
<tr>
<td width="50%">

### 🧠 Council Workflow (Multi-Expert)
A unique collaborative mode where multiple models (**GPT-5.4, Claude Opus 4.6, Gemini 3.1 Pro**) act as parallel experts to reason about a query, and a final model (**Seed 2.0 Pro**) synthesizes the consensus. It automatically bypasses trivial questions via an AI triage layer.
[Read the math & architecture](./ARCHITECTURE.md#2-the-council-module)

### 🤖 Agent Runtime
A fully isolated, ReAct-style orchestration layer featuring an instruction engine, tool registry, and state serialization for autonomous task execution with built-in memory management.
[View the Agent diagram](./ARCHITECTURE.md#3-the-agent-module)

### 🔌 Official API Integration
All 8 models are integrated via their official APIs or official deployments to ensure maximum stability, proper context windows (up to 1M tokens), and native streaming capabilities.

</td>
<td width="50%">

### 🌐 Web Search & Browsing
Grounded generation powered by Volcengine's real-time indexing API. Includes a full server-side browsing tool loop capable of searching, crawling single pages, and batch crawling multiple URLs.

### 📎 Multimodal Document Parsing
Upload and parse images, PDFs, Word docs, spreadsheets, and code files. Processed securely via a **Vercel Sandbox** running Python 3.13 with deep extraction capabilities.

### 💭 Real-time Thinking Blocks
Stream and display the model's internal reasoning processes in real-time, providing transparency into how the AI forms its conclusions via our custom Server-Sent Events (SSE) protocol.

</td>
</tr>
</table>

---

## 🏗️ Tech Stack

<table>
<tr>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=nextjs" width="48" height="48" alt="Next.js" /><br><sub>Next.js 16</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=react" width="48" height="48" alt="React" /><br><sub>React 19</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=tailwind" width="48" height="48" alt="Tailwind" /><br><sub>Tailwind CSS</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=mongodb" width="48" height="48" alt="MongoDB" /><br><sub>MongoDB</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=vercel" width="48" height="48" alt="Vercel" /><br><sub>Vercel</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=nodejs" width="48" height="48" alt="Node.js" /><br><sub>Node 24</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=python" width="48" height="48" alt="Python" /><br><sub>Python 3.13</sub><br></td>
</tr>
</table>

### Core Technologies
- **Auth**: JWT (jose), bcryptjs, HttpOnly cookies.
- **File Storage**: `@vercel/blob` (Direct client uploads, SSRF-protected download proxies).
- **LLM SDKs**: `@anthropic-ai/sdk`, Google GenAI, OpenAI REST, Volcengine ARK.
- **Rendering**: `react-markdown`, `remark-math`, `rehype-katex`, `rehype-highlight`.

---

## 🚀 Deployment

Vectaix AI is designed exclusively for **Vercel Pro** serverless deployment. It guarantees high concurrency and zero-maintenance scaling.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNoah-Wu66%2FVectaix-AI)

### Environment Variables

| Variable | Required | Purpose |
|:---------|:--------:|:--------|
| `MONGO_URI` | ✅ | MongoDB connection string for stateful memory |
| `JWT_SECRET` | ✅ | Cryptographic secret for session verification (HS256) |
| `ADMIN_EMAILS` | ❌ | Comma-separated admin email list |
| `OPENAI_API_KEY` | ✅ | Official OpenAI access |
| `ANTHROPIC_API_KEY` | ✅ | Official Anthropic access |
| `GEMINI_API_KEY` | ✅ | Official Google Gemini access |
| `DEEPSEEK_API_KEY` | ✅ | Official DeepSeek access |
| `ARK_API_KEY` | ✅ | Official ByteDance Seed & Volcengine ARK access |
| `MINIMAX_API_KEY` | ✅ | Official MiniMax access |
| `MIMO_API_BASE_URL` | ✅ | MiMo deployment base URL |
| `MIMO_API_KEY` | ❌ | MiMo API key (if required) |
| `VOLCENGINE_WEB_SEARCH_API_KEY` | ⬚ | Web search capabilities |

---

## 🗺️ Roadmap

- [x] Multi-model chat with 8 AI models
- [x] Dual-Engine: Council Workflow & Agent Runtime
- [x] Web search & web browsing tool loop
- [x] Vercel Sandbox Python document parsing
- [x] Real-time reasoning (Thinking Blocks)
- [x] PWA support & secure JWT auth
- [ ] Plugin / extension system expansion
- [ ] Collaborative workspaces
- [ ] Self-hosted Docker support

---

## 🤝 Contributing & License

Contributions are welcome! Please fork the repository and open a Pull Request.

This project is licensed under the [MIT License](LICENSE).

<div align="center">

## ⭐ Star History

<a href="https://star-history.com/#Noah-Wu66/Vectaix-AI&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
 </picture>
</a>

</div>