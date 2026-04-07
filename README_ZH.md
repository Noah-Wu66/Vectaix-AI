<div align="center">

# Vectaix AI

### 体验下一代人工智能

**多模型 AI 聊天平台，内置 Council Mode 共识驱动智能框架**

[![arXiv](https://img.shields.io/badge/arXiv-2604.02923-b31b1b.svg)](http://arxiv.org/abs/2604.02923)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Deployed on Vercel](https://img.shields.io/badge/部署于-Vercel-000?logo=vercel)](https://vercel.com/)
[![License](https://img.shields.io/badge/许可证-MIT-blue.svg)](LICENSE)

<br/>

[English](README.md) | [简体中文](README_ZH.md) | [日本語](README_JA.md)

<br/>

<img src="https://img.shields.io/badge/GPT--5.4-412991?style=for-the-badge&logo=openai&logoColor=white" alt="GPT-5.4"/>
<img src="https://img.shields.io/badge/Claude%20Opus%204.6-D97757?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Opus 4.6"/>
<img src="https://img.shields.io/badge/Gemini%203.1%20Pro-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Gemini 3.1 Pro"/>
<img src="https://img.shields.io/badge/DeepSeek-4D6BFF?style=for-the-badge" alt="DeepSeek"/>
<img src="https://img.shields.io/badge/通义千问-6C3AFF?style=for-the-badge" alt="Qwen"/>
<img src="https://img.shields.io/badge/豆包--Seed-FF6A00?style=for-the-badge" alt="Doubao-Seed"/>

</div>

<br/>

## 关于

**Vectaix AI** 是一个功能完备的多模型 AI 聊天平台，将全球最强大的语言模型汇聚于统一界面。其核心是 **Council Mode（理事会模式）**—— 一种新颖的多智能体共识框架，能够将查询并行分发至多个前沿大模型，并综合它们的输出以减少幻觉和偏见。

> **研究论文**：*Council Mode: Mitigating Hallucination and Bias in LLMs via Multi-Agent Consensus*
>
> 吴帅、李雪、冯雅娜、李宇芳、王志军
>
> [在 arXiv 上阅读 &rarr;](http://arxiv.org/abs/2604.02923)

<br/>

## 核心功能

### 多模型聊天

| 功能 | 描述 |
|:---|:---|
| **6+ 前沿模型** | GPT-5.4、Claude Opus 4.6、Gemini 3.1 Pro、DeepSeek、通义千问、豆包-Seed |
| **无缝切换** | 对话中随时切换模型，上下文完整保留 |
| **思维推理** | 可调节的思考深度，支持扩展推理的模型 |
| **输出长度控制** | 按模型精细调整最大输出 Token 数 |

### Council Mode（理事会模式）

| 功能 | 描述 |
|:---|:---|
| **多智能体共识** | 三位专家（GPT、Claude、Gemini）共同讨论并综合出统一答案 |
| **减少幻觉** | 在 HaluEval 基准上实现 35.9% 的相对降幅 |
| **缓解偏见** | 跨领域偏见方差显著降低 |
| **结构化综合** | 明确标识共识、分歧和独特发现 |

### 丰富交互

| 功能 | 描述 |
|:---|:---|
| **网页浏览** | 实时联网搜索与网页抓取，支持行内引用 |
| **文件理解** | 上传并分析图片、PDF、Word 文档和 Excel 表格 |
| **代码沙箱** | 在安全的 Vercel Sandbox 环境中执行代码 |
| **Markdown 渲染** | 完整 GFM 支持，包含 LaTeX 数学公式、语法高亮和表格 |

### 平台特性

| 功能 | 描述 |
|:---|:---|
| **对话历史** | 持久化聊天记录，支持长对话压缩 |
| **系统提示词** | 可自定义系统提示词，支持预设保存与加载 |
| **深色 / 浅色主题** | 精美的主题切换，丝滑过渡动画 |
| **PWA 支持** | 可安装为类原生应用，支持任何设备 |
| **用户认证** | 基于 JWT 的安全登录与注册 |

<br/>

## 技术栈

| 层级 | 技术 |
|:---|:---|
| **前端** | Next.js 16、React 19、Tailwind CSS、Framer Motion、Ant Design |
| **后端** | Next.js API Routes (Node.js)、SSE 流式传输 |
| **数据库** | MongoDB (Mongoose) |
| **存储** | Vercel Blob |
| **AI SDK** | Google GenAI、Anthropic SDK、OpenAI API |
| **沙箱** | Vercel Sandbox |
| **部署** | Vercel |

<br/>

## ���速开始

### 前置要求

- Node.js 18+
- MongoDB 实例
- 所需 AI 服务商的 API 密钥

### 安装

```bash
# 克隆仓库
git clone https://github.com/Noah-Wu66/Vectaix-AI.git
cd Vectaix-AI

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 环境变量

部署时需配置以下环境变量：

| 变量 | 描述 |
|:---|:---|
| `MONGODB_URI` | MongoDB 连接字符串 |
| `JWT_SECRET` | JWT 认证密钥 |
| `GOOGLE_AI_API_KEY` | Google Gemini API 密钥 |
| `ANTHROPIC_API_KEY` | Anthropic Claude API 密钥 |
| `OPENAI_API_KEY` | OpenAI GPT API 密钥 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 存储令牌 |

<br/>

## 研究论文

本项目实现了我们论文中描述的 **Council Mode** 框架：

```bibtex
@article{wu2026council,
  title={Council Mode: Mitigating Hallucination and Bias in LLMs via Multi-Agent Consensus},
  author={Wu, Shuai and Li, Xue and Feng, Yanna and Li, Yufang and Wang, Zhijun},
  journal={arXiv preprint arXiv:2604.02923},
  year={2026}
}
```

### 核心成果

| 指标 | Council Mode | 最佳单一模型 | 提升 |
|:---|:---:|:---:|:---:|
| HaluEval（幻觉检测） | - | - | **相对降低 35.9%** |
| TruthfulQA | - | - | **+7.8 分** |
| 偏见方差 | - | - | **显著降低** |

<br/>

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

<br/>

---

<div align="center">

### Star 趋势

[![Star History Chart](https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date)](https://star-history.com/#Noah-Wu66/Vectaix-AI&Date)

<br/>

如果这个项目对你有帮助，请考虑给一个 Star！

[![GitHub stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=social)](https://github.com/Noah-Wu66/Vectaix-AI)

<sub>以智能构建，以共识驱动。</sub>

</div>
