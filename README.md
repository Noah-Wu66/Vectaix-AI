# Vectaix AI

跑在 Vercel 上的多模型 AI 聊天应用，前端、API、定时任务全在一个 Next.js 16 App Router 项目里。

不是套壳聊天页，是一个完整的 AI Web 产品。

## 能干什么

- 多模型聊天，OpenAI / Claude / Gemini / Seed / DeepSeek 都能切
- Agent 模式，能规划、执行工具、等审批、继续跑、记住上次聊了啥
- Council 模式，几个模型各答一遍，再综合出结果
- 传文件，图片、文本、代码、PDF、Word、Excel、CSV 都行
- 联网搜索，自动判断要不要搜，搜完整理好喂给模型
- 用户系统，注册登录改密退出，还有企业 SSO
- 个人设置，头像、系统提示词、主题、字号、联网开关什么的
- 管理后台，管用户、清异常数据、重置 Agent 沙箱
- 数据迁移，导出自己的对话和设置，换地方再导回来

## 模型支持情况

| 模型 | 图片 | 文档附件 | 联网 | Agent | 记忆 |
| --- | --- | --- | --- | --- | --- |
| `Agent` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `Council` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `Gemini 3.1 Pro` | ✓ | ✗ | ✓ | ✗ | ✗ |
| `Claude Opus 4.6` | ✓ | ✗ | ✓ | ✗ | ✗ |
| `ChatGPT 5.4` | ✓ | ✗ | ✓ | ✗ | ✗ |
| `Seed 2.0 Pro` | ✓ | ✗ | ✓ | ✗ | ✗ |
| `DeepSeek V3.2` | ✗ | ✗ | ✓ | ✗ | ✗ |

默认用 `DeepSeek V3.2`。

## 文件上传

### 能传什么

- 图片：jpg、jpeg、png、gif、webp
- 文本：txt、md、markdown、log
- 代码：py、js、mjs、cjs、ts、tsx、jsx、html、css、xml、yml、yaml、sql、sh、ini、conf
- 数据：json
- 文档：pdf、doc、docx
- 表格：xls、xlsx、csv

### 限制

- 文档附件目前只有 Agent 能用
- 一次最多传 5 个
- 图片最大 20MB
- 文本/代码最大 2MB
- PDF/Word 最大 15MB
- Excel/CSV 最大 10MB
- PDF 最多 120 页
- 表格最多 10 个 sheet，行列和单元格数量也有上限

文件信息记在 MongoDB，文件本体存 Vercel Blob。文档解析和 Agent 跑任务用 Vercel Sandbox。

## 项目结构

```text
app/
  api/
    admin/                  管理员接口
    agent/                  Agent 入口、状态、审批/取消
    anthropic/              Claude 对话
    auth/                   注册、登录、退出、改密、SSO、当前用户
    bytedance/              Seed / 火山引擎对话
    chat/                   联网搜索、历史压缩之类的辅助接口
    conversations/          对话的增删改查
    council/                多专家会审
    cron/                   定时任务
    data/                   导出 / 导入
    deepseek/               DeepSeek 对话
    files/                  文档准备、文件下载
    google/                 Gemini 对话
    images/                 图片下载
    model-routes/           用户的模型线路
    openai/                 OpenAI 对话
    settings/               用户设置
    upload/                 Blob 上传签名与落库
  components/               UI 组件
  ChatApp.js                聊天主页面
  layout.js                 根布局
  page.js                   首页

lib/
  client/                   前端请求、状态、导出、Hook
  server/
    agent/                  Agent 运行时
    chat/                   联网搜索配置
    conversations/          对话清洗
    data/                   导入导出
    files/                  文档解析、附件准备
    sandbox/                Vercel Sandbox 封装
    seed/                   Seed 相关
    settings/               用户设置
  shared/                   模型定义、附件规则、共享常量
  admin.js                  管理员权限
  auth.js                   JWT 与 Cookie
  db.js                     MongoDB 连接
  modelRoutes.js            按用户读上游线路配置
  rateLimit.js              限流

models/
  AgentRun.js
  BlobFile.js
  Conversation.js
  MemoryEntry.js
  User.js
  UserSettings.js

public/
  audio/                    提示音
  icons/                    图标

scripts/
  sandbox/parse_attachment.py

proxy.js                    CSP、安全头、Nonce
vercel.json                 cron 配置
```

## 数据表

### User

用户邮箱、密码哈希、是不是高级用户、创建时间。

### UserSettings

每个用户的个人设置——头像、模型线路、系统提示词列表、当前用的提示词、主题、字号、联网开关。

### Conversation

每条对话——归属用户、标题、当前模型、消息数组、对话级设置、是否置顶、更新时间。

消息里除了文本，还可能带 `parts`、`citations`、`thinkingTimeline`、`councilExperts`、`agentRun`。

### BlobFile

上传文件的记录——地址、原始文件名、类型、大小、分类、解析状态、提取出来的文本、视觉资产信息。

### AgentRun

Agent 执行过程——目标、状态、步骤列表、审批请求、最终回答、报错、产物、沙箱会话、能不能继续跑。

### MemoryEntry

Agent 的会话记忆摘要，让下次任务能接上之前的上下文。

## 常用接口

### 鉴权

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `DELETE /api/auth/me`
- `POST /api/auth/change-password`
- `GET /api/auth/enterprise`
- `GET /api/model-routes`
- `PATCH /api/model-routes`

### 聊天

- `POST /api/openai`
- `POST /api/anthropic`
- `POST /api/google`
- `POST /api/deepseek`
- `POST /api/bytedance`
- `POST /api/council`
- `POST /api/agent`
- `POST /api/chat/compress`

### 对话和附件

- `GET /api/conversations`
- `GET /api/conversations/[id]`
- `PUT /api/conversations/[id]`
- `DELETE /api/conversations/[id]`
- `POST /api/upload`
- `GET /api/files/download`
- `GET /api/images/download`

### Agent 控制

- `POST /api/agent/runs/[id]/action`

动作有 `approve`、`reject`、`cancel`。

### 数据导入导出

- `GET /api/data/export`
- `POST /api/data/import`

### 管理员

- `GET /api/admin/users`
- `POST /api/admin/users`
- `POST /api/admin/users/[id]`
- `PATCH /api/admin/users/[id]`
- `DELETE /api/admin/users/[id]`
- `GET /api/admin/agent-sandbox`
- `POST /api/admin/agent-sandbox`

### 定时任务

- `GET /api/cron/cleanup-blobs`

## 环境变量

### 必填

- `MONGO_URI` — MongoDB 连接地址
- `JWT_SECRET` — 登录用的 JWT 密钥
- `DEEPSEEK_API_KEY` — DeepSeek 对话
- `ARK_API_KEY` — Seed 对话和 Agent 跑任务
- `AICODEMIRROR_API_KEY` — OpenAI、Claude Opus、Gemini 走 AICodeMirror 普通线路
- `VOLCENGINE_WEB_SEARCH_API_KEY` — 联网搜索

### 按需填

- `GEMINI_API_KEY` — 高级用户/管理员把 Gemini 切到 Google 原生线路时要用
- `AICODEMIRROR_OPENAI_BASE_URL` — OpenAI 普通线路地址，不填走默认
- `AICODEMIRROR_CLAUDE_BASE_URL` — Claude Opus 普通线路地址，不填走默认
- `AICODEMIRROR_GEMINI_BASE_URL` — Gemini 普通线路地址，不填走默认
- `ZENMUX_API_KEY` — 高级用户/管理员把 OpenAI 或 Opus 切到 zenmux 线路时要用
- `ADMIN_EMAILS` — 管理员邮箱白名单，逗号分隔
- `OA_SSO_SECRET` — 企业 SSO 校验密钥
- `CRON_SECRET` — 保护定时任务接口

## 部署

- 部署平台：Vercel
- Node 版本：24.x
- 定时任务配置：vercel.json
- cron 时间：`0 3 * * *`（每天凌晨 3 点）

定时任务干两件事：清过期/失效的 Blob 文件，把卡住的 Agent 任务恢复成可继续状态。

## 安全

- 中间件动态生成 CSP Nonce
- Content-Security-Policy
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Strict-Transport-Security
- Referrer-Policy
- Permissions-Policy
- 登录、注册、聊天压缩、导入导出、上传都有限流
- 文件扩展名和 MIME 类型双重校验
- 管理员邮箱白名单

## 建议先看的文件

接手或者继续改的话，从这几个文件看起比较顺：

- `app/ChatApp.js` — 前端聊天主入口
- `lib/client/chat/chatClient.js` — 前端聊天请求、流式返回、消息拼接
- `lib/shared/models.js` — 模型列表和能力定义
- `app/api/agent/route.js` — Agent 入口
- `lib/server/agent/runtimeV2.js` — Agent 核心执行逻辑
- `app/api/council/route.js` — Council 会审
- `lib/server/files/service.js` — 文档解析和附件准备
- `lib/server/sandbox/vercelSandbox.js` — Vercel Sandbox 封装
- `lib/modelRoutes.js` — 上游线路切换
