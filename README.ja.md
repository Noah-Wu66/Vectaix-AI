<div align="center">

# 🌌 Vectaix AI

### オープンソース AI ワークスペース — マルチモデル、マルチエキスパート、ワンプラットフォーム。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=gold)](https://github.com/Noah-Wu66/Vectaix-AI/stargazers)
[![Forks](https://img.shields.io/github/forks/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=silver)](https://github.com/Noah-Wu66/Vectaix-AI/network/members)
[![Issues](https://img.shields.io/github/issues/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=orange)](https://github.com/Noah-Wu66/Vectaix-AI/issues)
[![Deploy with Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Node](https://img.shields.io/badge/Node-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)

<br/>

[English](./README.md) · [简体中文](./README.zh-CN.md) · **日本語** · [한국어](./README.ko.md)

<br/>

> ⚠️ **アーリーステージのお知らせ** — 本プロジェクトは活発に開発中です。機能、API、UIは頻繁に変更される可能性があります。継続的なアップデートと改善をお約束します。最新情報を受け取るにはStarをお願いします！

<br/>

<img src="https://img.shields.io/badge/GPT--5.4-412991?style=flat-square&logo=openai&logoColor=white" alt="GPT-5.4" />
<img src="https://img.shields.io/badge/Claude_Opus_4.6-d97706?style=flat-square&logo=anthropic&logoColor=white" alt="Claude" />
<img src="https://img.shields.io/badge/Gemini_3.1_Pro_Preview-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemini" />
<img src="https://img.shields.io/badge/DeepSeek_V3.2-0A0A0A?style=flat-square&logoColor=white" alt="DeepSeek" />
<img src="https://img.shields.io/badge/Seed_2.0_Pro-FF6A00?style=flat-square&logoColor=white" alt="Seed" />

</div>

---

## ✨ Vectaix AI とは？

Vectaix AI は、Vercel クラウドネイティブデプロイ向けに設計された**オープンソース AI ワークスペース**です。世界をリードする AI モデルを統一インターフェースに集約し、公式 API サポートと独自のマルチエキスパート協調システムを提供します。

GPT-5.4 の素早い回答、Claude Opus 4.6 の深い推論、複数の AI エキスパートによる議論と統合 — Vectaix AI がすべてをカバーします。

---

## 🎯 主な機能

<table>
<tr>
<td width="50%">

### 🤖 マルチモデルチャット
1つのワークスペースで8つのAIモデルを自由に切り替え。各会話に異なるモデルをバインド可能。

### 🧠 Council ワークフロー
独自のマルチエキスパート協調モード：GPT-5.4、Claude Opus 4.6、Gemini 3.1 Pro Preview が並列エキスパートとして回答し、Seed 2.0 Pro が最終回答を統合。

### 🔌 公式接続
すべてのモデルが公式 API または公式デプロイのみを使用し、ルート切り替えは廃止されています。

</td>
<td width="50%">

### 🌐 Web 検索 & ブラウジング
Volcengine API による高度なフィルター付き Web 検索。コンテンツ抽出付きの完全な Web ブラウジングセッション。

### 📎 ファイルアップロード & 解析
画像、PDF、Word、Excel、コードファイルのアップロードと解析。Vercel Sandbox の Python ランタイムで処理。

### 💭 思考プロセス表示
モデルの推論プロセスをリアルタイムでストリーム表示し、AI がどのように考えているかを透明化。

</td>
</tr>
</table>

<table>
<tr>
<td width="33%">

### 🔐 認証
メール/パスワード認証、JWT トークン + HttpOnly Cookie。管理者システム対応。

</td>
<td width="33%">

### 🤖 Agent ランタイム
命令エンジン、ツールレジストリ、オーケストレーター、状態シリアライゼーションを備えた完全な Agent フレームワーク。

</td>
<td width="33%">

### 📱 PWA 対応
Web App Manifest、モバイル最適化 UI。ダーク/ライト/システム連動テーマ対応。

</td>
</tr>
</table>

---

## 🧩 対応モデル

| モデル | プロバイダー | 接続方式 | 特徴 |
|:-------|:-------------|:-------------|:-----|
| **GPT-5.4** | OpenAI | 公式 API | 汎用知能、コーディング、分析 |
| **Claude Opus 4.6** | Anthropic | 公式 API | 深い推論、ライティング、安全性 |
| **Gemini 3.1 Pro Preview** | Google | 公式 API | マルチモーダル、長文コンテキスト |
| **DeepSeek V3.2** | DeepSeek | 公式 API | 推論、数学、コード |
| **Seed 2.0 Pro** | ByteDance | 公式 API | 中国語、要約 |
| **MiMo** | Xiaomi | 公式デプロイ | 推論、小型モデル性能 |
| **MiniMax M2.5** | MiniMax | 公式 API | 多言語生成、コーディング |
| **Council** | マルチモデル | GPT + Claude + Gemini + Seed | エキスパート合意統合 |

---

## 🏗️ 技術スタック

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

| レイヤー | 技術 |
|:---------|:-----|
| フレームワーク | Next.js 16 (App Router) |
| フロントエンド | React 19、Tailwind CSS 3.4、Ant Design 5、Framer Motion |
| データベース | MongoDB (Mongoose 8) |
| 認証 | JWT (jose)、bcryptjs、HttpOnly Cookie |
| ファイルストレージ | Vercel Blob |
| サンドボックス | @vercel/sandbox (Node 24 + Python 3.13) |
| AI SDK | @anthropic-ai/sdk、Gemini REST、OpenAI REST、Volcengine Seed |
| Markdown | react-markdown + remark-gfm + remark-math + rehype-katex |
| ドキュメント解析 | pdf-parse、mammoth、word-extractor、xlsx |

---

## 🚀 デプロイ

Vectaix AI は **Vercel Pro** デプロイ向けに設計されています。ローカルランタイムは提供されません。

### 前提条件

- Vercel Pro アカウント
- MongoDB データベース（例：MongoDB Atlas）
- 使用する AI プロバイダーの API キー

### 環境変数

| 変数 | 必須 | 用途 |
|:-----|:----:|:-----|
| `MONGO_URI` | ✅ | MongoDB 接続文字列 |
| `JWT_SECRET` | ✅ | 認証トークン署名シークレット |
| `ADMIN_EMAILS` | ❌ | 管理者メールリスト（カンマ区切り） |
| `OPENAI_API_KEY` | ✅ | OpenAI 公式 API |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic 公式 API |
| `GEMINI_API_KEY` | ✅ | Google Gemini 公式 API |
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek 公式 API |
| `ARK_API_KEY` | ✅ | ByteDance Seed 公式 API |
| `MINIMAX_API_KEY` | ✅ | MiniMax 公式 API |
| `MINIMAX_MODEL_ID` | ❌ | MiniMax モデル ID、既定値は `MiniMax-M2.5` |
| `MIMO_API_BASE_URL` | ✅ | MiMo デプロイ先のベース URL。例: `https://your-mimo-server/v1` |
| `MIMO_API_KEY` | ❌ | MiMo デプロイ先の API キー |
| `MIMO_MODEL_ID` | ❌ | MiMo デプロイモデル ID、既定値は `XiaomiMiMo/MiMo-7B-RL-0530` |
| `VOLCENGINE_WEB_SEARCH_API_KEY` | ⬚ | Web 検索（現在はオプション） |

---

## 🗺️ ロードマップ

- [x] 8つの AI モデルによるマルチモデルチャット
- [x] Council マルチエキスパートワークフロー
- [x] 公式接続
- [x] Web 検索 & ブラウジング
- [x] ファイルアップロード & ドキュメント解析
- [x] Agent ランタイムフレームワーク
- [x] 思考プロセス表示
- [x] PWA サポート
- [ ] より多くのモデルプロバイダー
- [ ] プラグイン / 拡張システム
- [ ] 音声入出力
- [ ] コラボレーションワークスペース
- [ ] モバイルネイティブアプリ
- [ ] セルフホスト Docker サポート

---

## 🤝 コントリビューション

あらゆる形式の貢献を歓迎します！バグ報告、機能リクエスト、プルリクエスト — すべてが重要です。

1. リポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチをプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

---

## 📄 ライセンス

本プロジェクトは [MIT ライセンス](LICENSE) の下で公開されています。

---

<div align="center">

## ⭐ Star 履歴

<a href="https://star-history.com/#Noah-Wu66/Vectaix-AI&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
 </picture>
</a>

<br/>
<br/>

**Vectaix AI が役に立ったら、ぜひ ⭐ をお願いします**

<br/>

[![Star this repo](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=social)](https://github.com/Noah-Wu66/Vectaix-AI)

<br/>

---

<sub>情熱で構築。オープンソースで駆動。</sub>

</div>
