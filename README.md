<div align="center">

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-Next%20Gen%20Intelligence-8B5CF6?style=for-the-badge&labelColor=1e1b4b">
  <img src="https://img.shields.io/badge/%E2%9C%A6%20VECTAIX%20AI-Next%20Gen%20Intelligence-8B5CF6?style=for-the-badge&labelColor=1e1b4b" alt="Vectaix AI" width="420"/>
</picture>

<br/><br/>

**Multi-Model AI Chat Platform with Fusion Mode for Consensus-Driven Intelligence**

<br/>

[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)](https://vercel.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

<br/>

[**English**](README.md)&nbsp;&nbsp;|&nbsp;&nbsp;[**简体中文**](README_ZH.md)&nbsp;&nbsp;|&nbsp;&nbsp;[**日本語**](README_JA.md)

<br/>

<table>
<tr>
<td align="center" width="150"><img src="https://img.shields.io/badge/-GPT--5.5-412991?style=for-the-badge&logo=openai&logoColor=white" alt="GPT-5.5"/><br/><sub><b>OpenAI</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Claude%20Opus%204.8-D97757?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude"/><br/><sub><b>Anthropic</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Gemini%203.5%20Flash-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Gemini"/><br/><sub><b>Google</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Doubao%20Seed%202.1-FF6A00?style=for-the-badge&logoColor=white" alt="Doubao"/><br/><sub><b>ByteDance</b></sub></td>
</tr>
<tr>
<td align="center" width="150"><img src="https://img.shields.io/badge/-OpenRouter%20Fusion-111827?style=for-the-badge&logoColor=white" alt="OpenRouter Fusion"/><br/><sub><b>OpenRouter</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-GPT%20Image%202-412991?style=for-the-badge&logo=openai&logoColor=white" alt="GPT Image 2"/><br/><sub><b>OpenAI</b></sub></td>
<td align="center" width="150"><img src="https://img.shields.io/badge/-Seedance%202.0-FF6A00?style=for-the-badge&logoColor=white" alt="Seedance"/><br/><sub><b>ByteDance</b></sub></td>
</tr>
</table>

</div>

<br/>

---

<br/>

## Overview

**Vectaix AI** is a production-grade, multi-model AI chat platform that unifies the world's most powerful language models under a single, elegant interface. Rather than locking users into one AI provider, Vectaix gives you the freedom to switch between — or even combine — frontier models seamlessly.

At its core is **Fusion Mode**, a novel multi-agent consensus framework that dispatches queries to multiple frontier LLMs in parallel and synthesizes their outputs through structured deliberation — dramatically reducing hallucination and bias.

<br/>

---

<br/>

## Features

### 🤖 Multi-Model Intelligence

Access 4 direct chat models plus Fusion Mode through a unified interface. Switch models mid-conversation with full context preservation.

| Model | Provider | Context Window | Inputs | Thinking | Web Search |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **Fusion** | OpenRouter | — | Text | — | — |
| **GPT 5.5** | OpenAI | 256K | Text, Image, File | ✅ | ✅ |
| **Claude Opus 4.8** | Anthropic | 200K | Text, Image, File | ✅ | ✅ |
| **Gemini 3.5 Flash** | Google | 1M | Text, Image, File | ✅ | ✅ |
| **Doubao Seed 2.1 Pro** | ByteDance | 128K | Text, Image, File | ✅ | ✅ |

Dedicated media models:

| Model | Provider | Capability |
|:---:|:---:|:---|
| **GPT Image 2** | OpenAI | Image generation and image editing |
| **Seedance 2.0 Standard** | ByteDance | Text-to-video and image-to-video |

<br/>

### 🏛️ Fusion Mode — Multi-Agent Consensus

The crown jewel of Vectaix AI. Inspired by the deliberative processes of real-world councils, this mode orchestrates multiple AI experts to arrive at a more truthful, balanced answer.

```
                              ┌─────────────────┐
                              │   User Query     │
                              └────────┬─────────┘
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                   ┌────────────┐┌────────────┐┌────────────┐
                   │    GPT     ││   Claude   ││   Gemini   │
                   │    5.5     ││  Opus 4.8  ││ 3.5 Flash  │
                   │  (Expert)  ││  (Expert)  ││  (Expert)  │
                   └─────┬──────┘└─────┬──────┘└─────┬──────┘
                         │             │             │
                         └─────────────┼─────────────┘
                                       ▼
                              ┌─────────────────┐
                              │OpenRouter Fusion│
                              │  (Synthesis)    │
                              └────────┬─────────┘
                                       │
                         ┌─────────────┼─────────────┐
                         ▼             ▼             ▼
                   ┌──────────┐ ┌──────────┐ ┌──────────┐
                   │Agreement │ │Key Diffs │ │ Unique   │
                   │  Points  │ │& Debates │ │ Insights │
                   └──────────┘ └──────────┘ └──────────┘
```

**How it works:**

1. **Parallel Generation** — Your query is simultaneously sent to GPT 5.5, Claude Opus 4.8, and Gemini 3.5 Flash
2. **Independent Reasoning** — Each expert reasons independently with its own strengths and knowledge
3. **Structured Synthesis** — OpenRouter Fusion analyzes all responses, identifying:
   - ✅ **Agreement** — Points where all experts converge
   - ⚖️ **Key Differences** — Where experts disagree and why
   - 💡 **Unique Insights** — Valuable perspectives from individual experts
   - 🔍 **Blind Spots** — Gaps that only cross-model analysis reveals

> Fusion Mode currently does not support web search; it focuses on text-only multi-model reasoning.

**Key Results from Research:**

| Benchmark | Improvement |
|:---|:---:|
| HaluEval (Hallucination Detection) | **35.9% relative reduction** |
| TruthfulQA | **+7.8 points over best individual model** |
| Cross-domain Bias Variance | **Significantly lower** |

<br/>

### 🌐 Web Browsing & Search

Real-time access to the internet with intelligent multi-round browsing capabilities.

- **Smart Search** — AI-driven query formulation for optimal search results
- **Page Crawling** — Deep page content extraction and analysis
- **Multi-Page Browsing** — Crawl multiple pages in a single session
- **Inline Citations** — Every claim backed by traceable source references

<br/>

### 📎 Rich File Understanding

Upload and analyze diverse file types directly in your conversation.

| File Type | Supported Formats | Capability |
|:---|:---|:---|
| 🖼️ **Images** | PNG, JPG, GIF, WebP | Visual analysis, OCR, description |
| 📄 **Documents** | PDF | Text extraction, analysis, Q&A |
| 📝 **Word** | DOCX, DOC | Full document parsing |
| 📊 **Spreadsheets** | XLSX, XLS | Data analysis, table understanding |

<br/>

### 🖥️ Code Sandbox

Execute code in a secure, isolated environment powered by **Vercel Sandbox**.

- **Secure Execution** — Sandboxed runtime with network policies
- **Real-time Output** — Stream stdout/stderr as code runs
- **File Operations** — Read/write files within the sandbox
- **Multi-language** — Python and more

<br/>

### ✨ Polished User Experience

<table>
<tr>
<td width="50%">

**💬 Conversation Management**
- Persistent chat history with MongoDB
- Intelligent long-conversation compression
- Pin important conversations
- Conversation-specific model & settings

</td>
<td width="50%">

**🎨 Themes & Customization**
- Dark / Light mode with smooth transitions
- Adjustable font size
- Completion sound with volume control
- Custom user avatars

</td>
</tr>
<tr>
<td width="50%">

**📝 Rich Markdown Rendering**
- Full GitHub Flavored Markdown (GFM)
- LaTeX math equations (KaTeX)
- Syntax-highlighted code blocks
- Scrollable tables with copy support

</td>
<td width="50%">

**🔐 Authentication & Security**
- JWT-based session management
- Bcrypt password hashing
- Rate limiting on all endpoints
- Admin user management panel

</td>
</tr>
<tr>
<td width="50%">

**⚙️ Advanced Controls**
- Per-model thinking level adjustment
- Max tokens control
- Custom system prompts with presets
- Media resolution settings

</td>
<td width="50%">

**📱 Progressive Web App**
- Installable on any device
- Mobile-optimized responsive UI
- Touch-friendly interface
- Offline-capable manifest

</td>
</tr>
</table>

<br/>

---

<br/>

## Architecture

```
vectaix-ai/
├── app/
│   ├── api/
│   │   ├── fusion/           # Fusion Mode orchestration
│   │   ├── chat/             # ZenMux chat & compression
│   │   ├── auth/             # Authentication endpoints
│   │   ├── conversations/    # Conversation CRUD
│   │   ├── media/            # Image/video generation
│   │   ├── upload/           # Blob file upload
│   │   └── admin/            # Admin management
│   ├── components/           # React UI components
│   │   ├── chat/             # Chat input & model selector
│   │   ├── message/          # Message display components
│   │   │   ├── FusionMessage.js # Fusion Mode result rendering
│   │   │   ├── MessageList.js
│   │   │   └── ...
│   └── ChatApp.js            # Root application component
├── lib/
│   ├── client/               # Client-side utilities
│   │   ├── chat/             # Chat actions & runtime
│   │   └── hooks/            # React hooks (theme, settings)
│   ├── server/               # Server-side logic
│   │   ├── chat/             # Provider adapters, config, prompts
│   │   ├── webBrowsing/      # Web search & crawl engine
│   │   ├── sandbox/          # Vercel Sandbox integration
│   │   └── conversations/    # Conversation storage logic
│   └── shared/               # Shared constants & types
│       ├── models.js         # Model definitions & capabilities
│       ├── attachments.js    # File type handling
│       └── webSearch.js      # Search configuration
├── models/                   # Mongoose schemas
│   ├── User.js
│   └── Conversation.js
└── public/                   # Static assets
```

<br/>

---

<br/>

## Tech Stack

<table>
<tr>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nextjs/nextjs-original.svg" width="48" height="48" alt="Next.js"/><br/><sub><b>Next.js 16</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg" width="48" height="48" alt="React"/><br/><sub><b>React 19</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/tailwindcss/tailwindcss-original.svg" width="48" height="48" alt="Tailwind"/><br/><sub><b>Tailwind CSS</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mongodb/mongodb-original.svg" width="48" height="48" alt="MongoDB"/><br/><sub><b>MongoDB</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg" width="48" height="48" alt="Node.js"/><br/><sub><b>Node.js</b></sub></td>
<td align="center" width="96"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/vercel/vercel-original.svg" width="48" height="48" alt="Vercel"/><br/><sub><b>Vercel</b></sub></td>
</tr>
</table>

| Layer | Technologies |
|:---|:---|
| **Frontend** | Next.js 16 · React 19 · Tailwind CSS · Framer Motion · Ant Design · Lucide Icons |
| **Backend** | Next.js API Routes · Node.js · SSE (Server-Sent Events) Streaming |
| **Database** | MongoDB with Mongoose ODM |
| **Storage** | Vercel Blob (file uploads & attachments) |
| **AI Providers** | ZenMux OpenAI-compatible routing · OpenRouter · Volcengine Ark |
| **Code Execution** | Vercel Sandbox (isolated runtime) |
| **Auth** | JWT (jose) · bcryptjs |
| **Rendering** | react-markdown · rehype-highlight · rehype-katex · remark-gfm · remark-math |
| **File Parsing** | pdf-parse · mammoth (DOCX) · word-extractor (DOC) · xlsx |
| **Deployment** | Vercel (Pro) |

<br/>

---

<br/>

## Getting Started

### Prerequisites

- **Node.js** 18+
- **MongoDB** instance (local or Atlas)
- API keys for at least one AI provider

### Installation

```bash
# Clone the repository
git clone https://github.com/Noah-Wu66/Vectaix-AI.git

# Navigate to the project
cd Vectaix-AI

# Install dependencies
npm install

# Start the development server
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|:---|:---:|:---|
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `JWT_SECRET` | ✅ | Secret key for JWT token signing |
| `ZENMUX_API_KEY` | — | ZenMux API key for GPT, Claude, Gemini, and image generation |
| `OPENROUTER_API_KEY` | — | OpenRouter API key for Fusion synthesis |
| `ARK_API_KEY` | — | Volcengine Ark API key for Doubao Seed and Seedance video |
| `BLOB_READ_WRITE_TOKEN` | — | Vercel Blob storage token |

> [!TIP]
> You only need API keys for the providers you want to use. The platform gracefully handles missing provider configurations.

<br/>

---

<br/>

## License

This project is licensed under the [MIT License](LICENSE).

<br/>

---

<div align="center">

<br/>

### ⭐ Star History

<a href="https://star-history.com/#Noah-Wu66/Vectaix-AI&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" width="600" />
  </picture>
</a>

<br/><br/>

**If you find Vectaix AI useful, please consider giving it a ⭐**

[![GitHub Stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&logoColor=white&label=Stars&color=fbbf24)](https://github.com/Noah-Wu66/Vectaix-AI/stargazers)
&nbsp;
[![GitHub Forks](https://img.shields.io/github/forks/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&logoColor=white&label=Forks&color=60a5fa)](https://github.com/Noah-Wu66/Vectaix-AI/network/members)

<br/>

<sub>Built with intelligence. Powered by consensus.</sub>

<br/>

</div>
