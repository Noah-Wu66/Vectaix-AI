<div align="center">

# 🌌 Vectaix AI

### Open-Source AI Workspace — Multi-Model, Multi-Expert, One Platform.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=gold)](https://github.com/Noah-Wu66/Vectaix-AI/stargazers)
[![Forks](https://img.shields.io/github/forks/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=silver)](https://github.com/Noah-Wu66/Vectaix-AI/network/members)
[![Issues](https://img.shields.io/github/issues/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=orange)](https://github.com/Noah-Wu66/Vectaix-AI/issues)
[![Deploy with Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Node](https://img.shields.io/badge/Node-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)

<br/>

**English** · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md)

<br/>

> ⚠️ **Early Stage Notice** — This project is under active development. Features, APIs, and UI may change frequently. We are committed to continuous updates and improvements. Star the repo to stay tuned!

<br/>

<img src="https://img.shields.io/badge/GPT--5.4-412991?style=flat-square&logo=openai&logoColor=white" alt="GPT-5.4" />
<img src="https://img.shields.io/badge/Claude_Opus_4.6-d97706?style=flat-square&logo=anthropic&logoColor=white" alt="Claude" />
<img src="https://img.shields.io/badge/Gemini_2.5_Pro-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemini" />
<img src="https://img.shields.io/badge/DeepSeek_V3.2-0A0A0A?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJ3aGl0ZSI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48L3N2Zz4=&logoColor=white" alt="DeepSeek" />
<img src="https://img.shields.io/badge/Seed_2.0_Pro-FF6A00?style=flat-square&logoColor=white" alt="Seed" />
<img src="https://img.shields.io/badge/OpenRouter-8B5CF6?style=flat-square&logoColor=white" alt="OpenRouter" />

</div>

---

## ✨ What is Vectaix AI?

Vectaix AI is an **open-source AI workspace** designed for cloud-native deployment on Vercel. It brings together the world's leading AI models under one unified interface — with official API support, intelligent routing, and a unique multi-expert collaboration system.

Whether you need a quick answer from GPT-5.4, deep reasoning from Claude Opus 4.6, or want multiple AI experts to debate and synthesize — Vectaix AI has you covered.

---

## 🎯 Key Features

<table>
<tr>
<td width="50%">

### 🤖 Multi-Model Chat
Switch freely between 8 AI models in a single workspace. Each conversation can be bound to a different model.

### 🧠 Council Workflow
A unique multi-expert collaboration mode: GPT-5.4, Claude Opus 4.6, and Gemini 2.5 Pro answer as parallel experts, then Seed 2.0 Pro synthesizes the final response.

### 🔀 Smart Model Routing
User-level route switching between Official APIs and OpenRouter for OpenAI, Claude, and Gemini — giving you flexibility and cost control.

</td>
<td width="50%">

### 🌐 Web Search & Browsing
Built-in web search powered by Volcengine API with advanced filters. Full web browsing sessions with content extraction.

### 📎 File Upload & Parsing
Upload and parse images, PDFs, Word docs, spreadsheets, code files — processed via Vercel Sandbox with Python runtime.

### 💭 Thinking Blocks
Stream and display model reasoning processes in real-time, giving you transparency into how AI thinks.

</td>
</tr>
</table>

<table>
<tr>
<td width="33%">

### 🔐 Authentication
Email/password auth with JWT tokens and HttpOnly cookies. Admin system via environment variables.

</td>
<td width="33%">

### 🤖 Agent Runtime
Full agent framework with instruction engine, tool registry, orchestrator, and state serialization.

</td>
<td width="33%">

### 📱 PWA Ready
Web App Manifest with mobile-optimized UI. Dark/Light/System theme support.

</td>
</tr>
</table>

---

## 🧩 Supported Models

| Model | Provider | Routing | Specialty |
|:------|:---------|:--------|:----------|
| **GPT-5.4** | OpenAI | Official / OpenRouter | General intelligence, coding, analysis |
| **Claude Opus 4.6** | Anthropic | Official / OpenRouter | Deep reasoning, writing, safety |
| **Gemini 2.5 Pro** | Google | Official / OpenRouter | Multimodal, long context |
| **DeepSeek V3.2** | DeepSeek | Official only | Reasoning, math, code |
| **Seed 2.0 Pro** | ByteDance | Official only | Chinese language, summarization |
| **MiMo V2 Flash** | Xiaomi | OpenRouter only | Fast inference |
| **MiniMax M2.5** | MiniMax | OpenRouter only | Multilingual generation |
| **Council** | Multi-model | GPT + Claude + Gemini + Seed | Expert consensus synthesis |

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

| Layer | Technology |
|:------|:-----------|
| Framework | Next.js 16 (App Router) |
| Frontend | React 19, Tailwind CSS 3.4, Ant Design 5, Framer Motion |
| Database | MongoDB (Mongoose 8) |
| Auth | JWT (jose), bcryptjs, HttpOnly Cookie |
| File Storage | Vercel Blob |
| Sandbox | @vercel/sandbox (Node 24 + Python 3.13) |
| AI SDKs | @anthropic-ai/sdk, @google/genai, OpenAI REST, Volcengine Seed |
| Markdown | react-markdown + remark-gfm + remark-math + rehype-katex |
| Doc Parsing | pdf-parse, mammoth, word-extractor, xlsx |

---

## 🚀 Deployment

Vectaix AI is designed for **Vercel Pro** deployment. No local runtime is provided.

### Prerequisites

- Vercel Pro account
- MongoDB database (e.g., MongoDB Atlas)
- API keys for the AI providers you want to use

### Environment Variables

| Variable | Required | Purpose |
|:---------|:--------:|:--------|
| `MONGO_URI` | ✅ | MongoDB connection string |
| `JWT_SECRET` | ✅ | Auth token signing secret |
| `ADMIN_EMAILS` | ❌ | Comma-separated admin email list |
| `OPENAI_API_KEY` | ✅ | Official OpenAI access |
| `ANTHROPIC_API_KEY` | ✅ | Official Anthropic access |
| `GEMINI_API_KEY` | ✅ | Official Google Gemini access |
| `DEEPSEEK_API_KEY` | ✅ | Official DeepSeek access |
| `ARK_API_KEY` | ✅ | Official ByteDance Seed access |
| `OPENROUTER_API_KEY` | ✅ | OpenRouter gateway access |
| `VOLCENGINE_WEB_SEARCH_API_KEY` | ⬚ | Web search (optional for now) |

> **Note:** No `.env.example` file is provided. This README is the single source of truth for environment configuration.

---

## 📁 Project Structure

```
vectaix-ai/
├── app/
│   ├── api/                  # 19 API route groups
│   │   ├── admin/            # User management, model routing
│   │   ├── agent/            # Agent runtime entry
│   │   ├── anthropic/        # Claude direct
│   │   ├── auth/             # Login / Register / Password
│   │   ├── council/          # Multi-model Council workflow
│   │   ├── conversations/    # Conversation CRUD
│   │   ├── deepseek/         # DeepSeek direct
│   │   ├── gemini/           # Gemini direct
│   │   ├── openai/           # OpenAI direct
│   │   ├── upload/           # File upload
│   │   └── ...               # More routes
│   ├── components/           # 20+ React components
│   ├── ChatApp.js            # Main chat application
│   ├── layout.js             # Root layout
│   └── globals.css           # Global styles
├── lib/
│   ├── server/               # Server-side logic
│   │   ├── agent/            # Agent framework (orchestrator, tools, state)
│   │   ├── chat/             # Provider adapters, OpenRouter
│   │   ├── search/           # Web search providers
│   │   ├── webBrowsing/      # Web browsing system
│   │   └── sandbox/          # Vercel Sandbox integration
│   ├── client/               # Client utilities & hooks
│   └── shared/               # Shared models & configs
├── models/                   # Mongoose schemas
├── scripts/sandbox/          # Python parsing scripts
├── public/                   # Static assets
└── vercel.json               # Vercel config & cron
```

---

## 🗺️ Roadmap

- [x] Multi-model chat with 8 AI models
- [x] Council multi-expert workflow
- [x] Smart model routing (Official / OpenRouter)
- [x] Web search & browsing
- [x] File upload & document parsing
- [x] Agent runtime framework
- [x] Thinking blocks display
- [x] PWA support
- [ ] More model providers
- [ ] Plugin / extension system
- [ ] Voice input & output
- [ ] Collaborative workspaces
- [ ] Mobile native app
- [ ] Self-hosted Docker support

---

## 🤝 Contributing

Contributions are welcome! Whether it's bug reports, feature requests, or pull requests — every bit helps.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">

## ⭐ Star History

<a href="https://star-history.com/#Noah-Wu66/Vectaix-AI&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
 </picture>
</a>

<br/>
<br/>

**If you find Vectaix AI useful, please consider giving it a ⭐**

<br/>

[![Star this repo](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=social)](https://github.com/Noah-Wu66/Vectaix-AI)

<br/>

---

<sub>Built with passion. Powered by open source.</sub>

</div>
