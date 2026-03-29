<div align="center">

# 🌌 Vectaix AI

### オープンソース AI ワークスペース — マルチエキスパート評議会と自律型Agentのためのデュアルエンジンアーキテクチャ

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=gold)](https://github.com/Noah-Wu66/Vectaix-AI/stargazers)
[![Deploy with Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Node](https://img.shields.io/badge/Node-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)

<br/>

[English](./README.md) · [简体中文](./README.zh-CN.md) · **日本語** · [한국어](./README.ko.md)

[📄 技術アーキテクチャのホワイトペーパーを読む (Architecture Paper)](./ARCHITECTURE.md)

<br/>

> ⚠️ **アーリーステージのお知らせ** — 本プロジェクトは活発に開発中です。機能、API、UIは頻繁に変更される可能性があります。最新情報を受け取るにはStarをお願いします！

<br/>

<img src="https://img.shields.io/badge/GPT--5.4-412991?style=flat-square&logo=openai&logoColor=white" alt="GPT-5.4" />
<img src="https://img.shields.io/badge/Claude_Opus_4.6-d97706?style=flat-square&logo=anthropic&logoColor=white" alt="Claude" />
<img src="https://img.shields.io/badge/Gemini_3.1_Pro_Preview-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemini" />
<img src="https://img.shields.io/badge/DeepSeek_V3.2-0A0A0A?style=flat-square&logoColor=white" alt="DeepSeek" />
<img src="https://img.shields.io/badge/Seed_2.0_Pro-FF6A00?style=flat-square&logoColor=white" alt="Seed" />

</div>

---

## ✨ Vectaix AI とは？

Vectaix AI は、Vercel クラウドネイティブデプロイ向けに設計された**オープンソース AI ワークスペース**です。世界をリードする AI モデルを統一インターフェースに集約し、厳密な [デュアルエンジンアーキテクチャ (Dual-Engine Architecture)](./ARCHITECTURE.ja.md) によって駆動されます。

GPT-5.4 の素早い回答、Claude Opus 4.6 の深い推論、あるいは複数の AI エキスパートによる議論と統合 — Vectaix AI は、洗練されたプロフェッショナルな体験を提供します。

### 🖼️ インターフェースのプレビュー

*(ここにチャットインターフェースのスクリーンショットまたは GIF を挿入します)*

---

## 🎯 主な機能

<table>
<tr>
<td width="50%">

### 🧠 Council ワークフロー (マルチエキスパート)
複数のモデル（例：GPT、Claude、Gemini）が並行するエキスパートとしてクエリを推論し、最終的なモデルがコンセンサスを統合する独自の協調モードです。
[数式とアーキテクチャ図を読む](./ARCHITECTURE.md#11-the-council-module-multi-expert-consensus)

### 🤖 Agent ランタイム
自律的なタスク実行のための命令エンジン、ツールレジストリ、状態のシリアライゼーションを備えた完全に分離されたオーケストレーションレイヤーです。
[Agent アーキテクチャ図を見る](./ARCHITECTURE.md#12-the-agent-module-autonomous-orchestration)

### 🔌 公式 API の統合
最大の安定性と能力を確保するため、すべてのモデルは公式 API または公式デプロイを介して統合されています。

</td>
<td width="50%">

### 🌐 Web 検索 & ブラウジング
Volcengine のリアルタイムインデックス API による Grounded な生成。コンテンツ抽出を伴う完全な Web ブラウジングセッションを備えています。

### 📎 マルチモーダルドキュメント解析
画像、PDF、Word、Excel、コードファイルのアップロードと解析。Vercel Sandbox の Python ランタイムを介して非同期的に処理されます。

### 💭 リアルタイムの思考プロセス
モデルの内部推論プロセスをリアルタイムでストリーミングして表示し、AI がどのように結論を導き出すかを透明化します。

</td>
</tr>
</table>

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

---

## 🚀 デプロイ

Vectaix AI は **Vercel Pro** サーバーレスデプロイ向けに設計されています。高い同時実行性とメンテナンスフリーのスケーラビリティを保証します。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNoah-Wu66%2FVectaix-AI)

### 環境変数

| 変数 | 必須 | 用途 |
|:-----|:----:|:-----|
| `MONGO_URI` | ✅ | ステートフルなメモリのための MongoDB 接続文字列 |
| `JWT_SECRET` | ✅ | セッション検証用の暗号化シークレット |
| `ADMIN_EMAILS` | ❌ | 管理者メールリスト（カンマ区切り） |
| `OPENAI_API_KEY` | ✅ | OpenAI 公式 API |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic 公式 API |
| `GEMINI_API_KEY` | ✅ | Google Gemini 公式 API |
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek 公式 API |
| `ARK_API_KEY` | ✅ | ByteDance Seed 公式 API |
| `MINIMAX_API_KEY` | ✅ | MiniMax 公式 API |
| `MIMO_API_BASE_URL` | ✅ | MiMo デプロイ先の URL |
| `VOLCENGINE_WEB_SEARCH_API_KEY` | ⬚ | Web 検索機能 |

---

## 🗺️ ロードマップ

- [x] 8つの AI モデルによるマルチモデルチャット
- [x] デュアルエンジン：Council ワークフロー & Agent ランタイム
- [x] Web 検索 & マルチモーダルドキュメント解析
- [x] リアルタイム推論 (Thinking Blocks) の表示
- [ ] プラグイン / 拡張システムの拡充
- [ ] コラボレーションワークスペース
- [ ] セルフホスト Docker サポート

---

## 🤝 コントリビューションとライセンス

あらゆる形式の貢献を歓迎します！リポジトリをフォークして Pull Request を開いてください。

本プロジェクトは [MIT ライセンス](LICENSE) の下で公開されています。

<div align="center">

## ⭐ Star 履歴

<a href="https://star-history.com/#Noah-Wu66/Vectaix-AI&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
 </picture>
</a>

</div>