<div align="center">

# Vectaix AI

### Experience the Next Generation of AI

**Multi-model AI chat platform with Council Mode for consensus-driven intelligence**

[![arXiv](https://img.shields.io/badge/arXiv-2604.02923-b31b1b.svg)](http://arxiv.org/abs/2604.02923)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000?logo=vercel)](https://vercel.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<br/>

[English](README.md) | [简体中文](README_ZH.md) | [日本語](README_JA.md)

<br/>

<img src="https://img.shields.io/badge/GPT--5.4-412991?style=for-the-badge&logo=openai&logoColor=white" alt="GPT-5.4"/>
<img src="https://img.shields.io/badge/Claude%20Opus%204.6-D97757?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Opus 4.6"/>
<img src="https://img.shields.io/badge/Gemini%203.1%20Pro-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Gemini 3.1 Pro"/>
<img src="https://img.shields.io/badge/DeepSeek-4D6BFF?style=for-the-badge" alt="DeepSeek"/>
<img src="https://img.shields.io/badge/Qwen-6C3AFF?style=for-the-badge" alt="Qwen"/>
<img src="https://img.shields.io/badge/Doubao--Seed-FF6A00?style=for-the-badge" alt="Doubao-Seed"/>

</div>

<br/>

## About

**Vectaix AI** is a full-featured, multi-model AI chat platform that brings together the world's most powerful language models in one unified interface. At its core is **Council Mode** — a novel multi-agent consensus framework that dispatches queries to multiple frontier LLMs in parallel and synthesizes their outputs to reduce hallucination and bias.

> **Research Paper**: *Council Mode: Mitigating Hallucination and Bias in LLMs via Multi-Agent Consensus*
>
> Shuai Wu, Xue Li, Yanna Feng, Yufang Li, Zhijun Wang
>
> [Read on arXiv &rarr;](http://arxiv.org/abs/2604.02923)

<br/>

## Key Features

### Multi-Model Chat

| Feature | Description |
|:---|:---|
| **6+ Frontier Models** | GPT-5.4, Claude Opus 4.6, Gemini 3.1 Pro, DeepSeek, Qwen, Doubao-Seed |
| **Seamless Switching** | Switch between models mid-conversation with preserved context |
| **Thinking/Reasoning** | Adjustable thinking levels for models that support extended reasoning |
| **Max Tokens Control** | Fine-tune output length per model |

### Council Mode

| Feature | Description |
|:---|:---|
| **Multi-Agent Consensus** | Three experts (GPT, Claude, Gemini) deliberate and synthesize a unified answer |
| **Hallucination Reduction** | 35.9% relative reduction on HaluEval benchmark |
| **Bias Mitigation** | Significantly lower bias variance across domains |
| **Structured Synthesis** | Identifies agreement, disagreement, and unique findings |

### Rich Interactions

| Feature | Description |
|:---|:---|
| **Web Browsing** | Real-time web search and page crawling with inline citations |
| **File Understanding** | Upload and analyze images, PDFs, Word docs, and Excel spreadsheets |
| **Code Sandbox** | Execute code in a secure Vercel Sandbox environment |
| **Markdown Rendering** | Full GFM support with LaTeX math, syntax highlighting, and tables |

### Platform

| Feature | Description |
|:---|:---|
| **Conversation History** | Persistent chat history with compression for long conversations |
| **System Prompts** | Customizable system prompts with save/load presets |
| **Dark / Light Theme** | Beautiful theme support with smooth transitions |
| **PWA Support** | Install as a native-like app on any device |
| **User Authentication** | Secure login/register with JWT-based sessions |

<br/>

## Tech Stack

| Layer | Technologies |
|:---|:---|
| **Frontend** | Next.js 16, React 19, Tailwind CSS, Framer Motion, Ant Design |
| **Backend** | Next.js API Routes (Node.js), SSE Streaming |
| **Database** | MongoDB (Mongoose) |
| **Storage** | Vercel Blob |
| **AI SDKs** | Google GenAI, Anthropic SDK, OpenAI API |
| **Sandbox** | Vercel Sandbox |
| **Deployment** | Vercel |

<br/>

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB instance
- API keys for the AI providers you want to use

### Installation

```bash
# Clone the repository
git clone https://github.com/Noah-Wu66/Vectaix-AI.git
cd Vectaix-AI

# Install dependencies
npm install

# Start the development server
npm run dev
```

### Environment Variables

Configure the following environment variables for your deployment:

| Variable | Description |
|:---|:---|
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret for JWT authentication |
| `GOOGLE_AI_API_KEY` | Google Gemini API key |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `OPENAI_API_KEY` | OpenAI GPT API key |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage token |

<br/>

## Research

This project implements the **Council Mode** framework described in our paper:

```bibtex
@article{wu2026council,
  title={Council Mode: Mitigating Hallucination and Bias in LLMs via Multi-Agent Consensus},
  author={Wu, Shuai and Li, Xue and Feng, Yanna and Li, Yufang and Wang, Zhijun},
  journal={arXiv preprint arXiv:2604.02923},
  year={2026}
}
```

### Key Results

| Metric | Council Mode | Best Individual Model | Improvement |
|:---|:---:|:---:|:---:|
| HaluEval (Hallucination) | - | - | **35.9% relative reduction** |
| TruthfulQA | - | - | **+7.8 points** |
| Bias Variance | - | - | **Significantly lower** |

<br/>

## License

This project is licensed under the [MIT License](LICENSE).

<br/>

---

<div align="center">

### Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date)](https://star-history.com/#Noah-Wu66/Vectaix-AI&Date)

<br/>

If you find this project useful, please consider giving it a star!

[![GitHub stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=social)](https://github.com/Noah-Wu66/Vectaix-AI)

<sub>Built with intelligence, powered by consensus.</sub>

</div>
