<div align="center">

# Vectaix AI

**一个完整的多模型 AI Web 产品，跑在 Vercel 上**

不是套壳聊天页 — 完整的用户系统、Agent 引擎、联网搜索、文件解析、管理后台，全在一个 Next.js 16 App Router 项目里。

![Version](https://img.shields.io/badge/版本-0.1.0_早期预览-orange?style=for-the-badge)
![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Node](https://img.shields.io/badge/Node-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Vercel](https://img.shields.io/badge/部署-Vercel_Pro-black?style=for-the-badge&logo=vercel&logoColor=white)

> 🚧 **本项目目前处于早期阶段（v0.1.0），功能还在快速迭代中，会持续更新。**
> 欢迎 Star ⭐ 关注最新进展，也欢迎提 Issue 反馈问题。

</div>

---

## 功能概览

| 功能模块 | 说明 |
|----------|------|
| **多模型聊天** | OpenAI / Claude / Gemini / Seed / DeepSeek / MiMo / MiniMax，统一界面切换，无需多开 |
| **Agent 模式** | 自主规划任务、调用工具、请求人工审批、继续跑、记住上次聊了啥 |
| **Council 模式** | 多个顶级模型各自独立回答同一问题，再综合出最终结论 |
| **联网搜索** | 自动判断是否需要搜索，抓取页面内容整理后喂给模型 |
| **文件上传** | 图片、文本、代码、PDF、Word、Excel、CSV 全支持 |
| **用户系统** | 注册 / 登录 / 改密 / 退出，支持企业 SSO 单点登录 |
| **个人设置** | 头像、系统提示词、界面主题、字号、联网开关 |
| **管理后台** | 管用户、清异常数据、重置 Agent 沙箱 |
| **数据迁移** | 导出自己的对话和设置，换地方再导回来 |

---

## 支持的模型

| 模型 | 提供商 | 上下文窗口 | 图片 | 文档附件 | 联网搜索 | Agent | 记忆 |
|------|--------|:----------:|:----:|:--------:|:--------:|:-----:|:----:|
| **Agent** | Vectaix | 256K | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Council** | 多专家会审 | — | ✅ | — | — | — | — |
| **Gemini 3.1 Pro** | Google | 1000K | ✅ | — | ✅ | — | — |
| **Claude Opus 4.6** | Anthropic | 200K | ✅ | — | ✅ | — | — |
| **ChatGPT 5.4** | OpenAI | 272K | ✅ | — | ✅ | — | — |
| **Seed 2.0 Pro** | ByteDance / 火山引擎 | 256K | ✅ | — | ✅ | — | — |
| **MiMo-V2-Pro** | 小米 | 1048K | — | — | — | — | — |
| **MiniMax-M2.7** | MiniMax | 204K | — | — | — | — | — |
| **DeepSeek V3.2** ⭐ | DeepSeek | 128K | — | — | ✅ | — | — |

> ⭐ 默认模型为 DeepSeek V3.2。文档附件目前仅 Agent 模式支持。

---

## 文件上传

### 支持的格式

| 类型 | 格式 | 大小上限 |
|------|------|----------|
| 图片 | jpg / jpeg / png / gif / webp | 20 MB |
| 文本 / 代码 | txt / md / py / js / ts / html / css / json / sql / yaml … | 2 MB |
| 文档 | pdf / doc / docx | 15 MB（PDF 最多 120 页） |
| 表格 | xls / xlsx / csv | 10 MB（最多 10 个 Sheet） |

- 一次最多上传 **5 个**文件
- 文件元数据存 **MongoDB**，文件本体存 **Vercel Blob**
- 文档解析和 Agent 任务运行在 **Vercel Sandbox**（Python 环境）

---

## 技术栈

```
框架        Next.js 16 (App Router) + React 19
样式        Tailwind CSS 3 + Ant Design 5 + Framer Motion
数据库      MongoDB（Mongoose 8）
文件存储    Vercel Blob
代码执行    Vercel Sandbox
认证        JWT（jose）+ bcryptjs + Cookie
Markdown    react-markdown + remark-gfm + remark-math + rehype-katex + rehype-highlight
安全        CSP Nonce 中间件 + 多重安全头 + 限流
部署        Vercel Pro
```

---

## 项目结构

```
Vectaix-AI/
├── app/
│   ├── api/
│   │   ├── admin/          管理员接口（用户管理、沙箱重置）
│   │   ├── agent/          Agent 入口、审批、取消
│   │   ├── anthropic/      Claude 对话
│   │   ├── auth/           注册、登录、改密、SSO
│   │   ├── bytedance/      Seed / 火山引擎对话
│   │   ├── chat/           联网搜索、历史压缩等辅助接口
│   │   ├── conversations/  对话增删改查
│   │   ├── council/        多专家会审
│   │   ├── cron/           定时任务（每天凌晨清理 Blob）
│   │   ├── data/           导出 / 导入
│   │   ├── deepseek/       DeepSeek 对话
│   │   ├── files/          文档准备、文件下载
│   │   ├── google/         Gemini 对话
│   │   ├── images/         图片下载
│   │   ├── model-routes/   用户模型线路配置
│   │   ├── openai/         OpenAI 对话
│   │   ├── settings/       用户设置
│   │   └── upload/         文件上传
│   ├── components/         前端 UI 组件（21 个）
│   ├── ChatApp.js          聊天主页面（核心前端入口）
│   ├── layout.js           根布局
│   └── page.js             首页
│
├── lib/
│   ├── client/             前端请求、Hook、消息导出
│   ├── server/
│   │   ├── agent/          Agent 执行引擎（runtimeV2.js）
│   │   ├── chat/           提供商适配器、联网搜索配置
│   │   ├── conversations/  对话清洗与服务
│   │   ├── files/          文档解析、附件准备
│   │   ├── sandbox/        Vercel Sandbox 封装
│   │   └── webBrowsing/    联网浏览（搜索、爬取、结果处理）
│   ├── shared/             模型定义、附件规则、共享常量
│   ├── auth.js             JWT 与 Cookie 管理
│   ├── db.js               MongoDB 连接
│   └── rateLimit.js        限流中间件
│
├── models/                 MongoDB 数据模型
│   ├── User.js
│   ├── UserSettings.js
│   ├── Conversation.js
│   ├── BlobFile.js
│   ├── AgentRun.js
│   └── MemoryEntry.js
│
├── scripts/sandbox/        Vercel Sandbox 里跑的 Python 脚本
├── proxy.js                CSP、安全头、Nonce 中间件
└── vercel.json             Cron 定时任务配置
```

---

## 部署到 Vercel

### 1. 克隆仓库

```bash
git clone https://github.com/your-repo/vectaix-ai.git
cd vectaix-ai
```

### 2. 配置环境变量

在 Vercel Dashboard → Settings → Environment Variables 中填入以下变量：

**必填**

| 变量名 | 说明 |
|--------|------|
| `MONGO_URI` | MongoDB 连接地址 |
| `JWT_SECRET` | JWT 签名密钥（随机字符串即可） |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `ARK_API_KEY` | 火山引擎 API Key（Seed 对话 + Agent 执行） |
| `AICODEMIRROR_API_KEY` | AICodeMirror Key（走 OpenAI / Claude / Gemini 普通线路） |
| `VOLCENGINE_WEB_SEARCH_API_KEY` | 火山引擎联网搜索 Key |

**按需填写**

| 变量名 | 说明 |
|--------|------|
| `GEMINI_API_KEY` | 高级用户把 Gemini 切到 Google 原生线路时使用 |
| `AICODEMIRROR_OPENAI_BASE_URL` | OpenAI 线路地址，不填走默认 |
| `AICODEMIRROR_CLAUDE_BASE_URL` | Claude 线路地址，不填走默认 |
| `AICODEMIRROR_GEMINI_BASE_URL` | Gemini 线路地址，不填走默认 |
| `ZENMUX_API_KEY` | 高级用户切到 Zenmux 线路时使用 |
| `ADMIN_EMAILS` | 管理员邮箱白名单，逗号分隔 |
| `OA_SSO_SECRET` | 企业 SSO 校验密钥 |
| `CRON_SECRET` | 保护定时任务接口 |

### 3. 部署

直接推送到 GitHub，连接 Vercel 后自动部署。Node 版本选 **24.x**。

> Vercel Dashboard → Settings → Functions 中建议将 Max Duration 配置为 **800 秒**（Agent 长任务需要）。

---

## 数据模型

| 集合 | 说明 |
|------|------|
| `User` | 用户邮箱、密码哈希、是否高级用户、创建时间 |
| `UserSettings` | 头像、模型线路、系统提示词列表、主题、字号、联网开关 |
| `Conversation` | 归属用户、标题、模型、消息数组（含思考链、引用、Council 专家详情）|
| `BlobFile` | 文件地址、原始名、类型、大小、解析状态、提取文本、视觉资产 |
| `AgentRun` | 目标、执行状态、步骤列表、审批请求、最终回答、沙箱会话 |
| `MemoryEntry` | Agent 会话记忆摘要，让下次任务能接上之前的上下文 |

---

## API 接口

<details>
<summary>展开查看完整接口列表</summary>

### 鉴权
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/me` | 获取当前用户 |
| DELETE | `/api/auth/me` | 注销账号 |
| POST | `/api/auth/change-password` | 改密 |
| GET | `/api/auth/enterprise` | 企业 SSO |
| GET | `/api/model-routes` | 读取模型线路 |
| PATCH | `/api/model-routes` | 更新模型线路 |

### 聊天
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/openai` | OpenAI 对话 |
| POST | `/api/anthropic` | Claude 对话 |
| POST | `/api/google` | Gemini 对话 |
| POST | `/api/deepseek` | DeepSeek 对话 |
| POST | `/api/bytedance` | Seed / 火山引擎对话 |
| POST | `/api/council` | 多专家会审 |
| POST | `/api/agent` | Agent 入口 |
| POST | `/api/chat/compress` | 历史压缩 |

### 对话与附件
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/conversations` | 对话列表 |
| GET | `/api/conversations/[id]` | 单条对话 |
| PUT | `/api/conversations/[id]` | 更新对话 |
| DELETE | `/api/conversations/[id]` | 删除对话 |
| POST | `/api/upload` | 文件上传 |
| GET | `/api/files/download` | 文档下载 |
| GET | `/api/images/download` | 图片下载 |

### Agent 控制
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/runs/[id]/action` | 审批 / 拒绝 / 取消（`approve` / `reject` / `cancel`） |

### 数据迁移
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/data/export` | 导出 |
| POST | `/api/data/import` | 导入 |

### 管理员
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/users` | 用户列表 |
| POST | `/api/admin/users` | 创建用户 |
| PATCH | `/api/admin/users/[id]` | 修改用户 |
| DELETE | `/api/admin/users/[id]` | 删除用户 |
| GET | `/api/admin/agent-sandbox` | 查看沙箱状态 |
| POST | `/api/admin/agent-sandbox` | 重置沙箱 |

</details>

---

## 安全机制

- 中间件动态生成 **CSP Nonce**，每次请求唯一
- `Content-Security-Policy` / `X-Frame-Options: DENY` / `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` / `Referrer-Policy` / `Permissions-Policy`
- 登录、注册、聊天、上传、导入导出均有**限流保护**
- 文件扩展名 + MIME 类型**双重校验**
- 管理员邮箱**白名单**控制权限

---

## 建议先看的文件

接手或参与开发，从这几个文件看起比较顺：

| 文件 | 说明 |
|------|------|
| `app/ChatApp.js` | 前端聊天主入口 |
| `lib/client/chat/chatClient.js` | 前端聊天请求、流式返回、消息拼接 |
| `lib/shared/models.js` | 所有模型定义和能力声明 |
| `app/api/agent/route.js` | Agent 接口入口 |
| `lib/server/agent/runtimeV2.js` | Agent 核心执行引擎 |
| `app/api/council/route.js` | Council 多专家会审 |
| `lib/server/files/service.js` | 文档解析和附件准备 |
| `lib/server/sandbox/vercelSandbox.js` | Vercel Sandbox 封装 |
| `lib/modelRoutes.js` | 上游线路切换逻辑 |

---

## 路线图

> 本项目目前为 **v0.1.0 早期版本**，以下功能正在计划或开发中，会持续更新。

- [ ] 更多模型支持
- [ ] Agent 工具扩展（代码执行、图表生成）
- [ ] 对话分享与公开链接
- [ ] 移动端适配优化
- [ ] 插件 / 扩展系统
- [ ] 多语言界面支持

---

<div align="center">

如有问题欢迎提 [Issue](../../issues) · 觉得有用请点个 Star ⭐

</div>
