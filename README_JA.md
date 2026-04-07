<div align="center">

# Vectaix AI

### 次世代AIを体験する

**マルチモデルAIチャットプラットフォーム — Council Modeによる合意駆動型インテリジェンス**

[![arXiv](https://img.shields.io/badge/arXiv-2604.02923-b31b1b.svg)](http://arxiv.org/abs/2604.02923)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Deployed on Vercel](https://img.shields.io/badge/デプロイ-Vercel-000?logo=vercel)](https://vercel.com/)
[![License](https://img.shields.io/badge/ライセンス-MIT-blue.svg)](LICENSE)

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

## 概要

**Vectaix AI** は、世界最先端の言語モデルを統一インターフェースに集約した、フル機能のマルチモデルAIチャットプラットフォームです。中核となる **Council Mode（評議会モード）** は、クエリを複数のフロンティアLLMに並列分配し、それらの出力を統合することでハルシネーションとバイアスを低減する、新しいマルチエージェント合意フレームワークです。

> **研究論文**: *Council Mode: Mitigating Hallucination and Bias in LLMs via Multi-Agent Consensus*
>
> Shuai Wu, Xue Li, Yanna Feng, Yufang Li, Zhijun Wang
>
> [arXivで読む &rarr;](http://arxiv.org/abs/2604.02923)

<br/>

## 主要機能

### マルチモデルチャット

| 機能 | 説明 |
|:---|:---|
| **6以上のフロンティアモデル** | GPT-5.4、Claude Opus 4.6、Gemini 3.1 Pro、DeepSeek、Qwen、Doubao-Seed |
| **シームレスな切り替え** | 会話中にモデルを切り替えても、コンテキストを維持 |
| **思考・推論** | 拡張推論をサポートするモデルの思考レベルを調整可能 |
| **出力長制御** | モデルごとに最大出力トークン数を調整 |

### Council Mode（評議会モード）

| 機能 | 説明 |
|:---|:---|
| **マルチエージェント合意** | 3つのエキスパート（GPT、Claude、Gemini）が議論し、統一された回答を合成 |
| **ハルシネーション低減** | HaluEvalベンチマークで35.9%の相対的削減 |
| **バイアス緩和** | ドメイン間のバイアス分散が大幅に低下 |
| **構造化合成** | 合意点、相違点、独自の知見を明確に識別 |

### リッチなインタラクション

| 機能 | 説明 |
|:---|:---|
| **ウェブブラウジング** | リアルタイムウェブ検索とページクロール（インライン引用付き） |
| **ファイル理解** | 画像、PDF、Wordドキュメント、Excelスプレッドシートのアップロードと分析 |
| **コードサンドボックス** | 安全なVercel Sandbox環境でコードを実行 |
| **Markdownレンダリング** | GFM完全サポート（LaTeX数式、シンタックスハイライト、テーブル） |

### プラットフォーム

| 機能 | 説明 |
|:---|:---|
| **会話履歴** | 永続的なチャット履歴、長い会話の圧縮に対応 |
| **システムプロンプト** | カスタマイズ可能なシステムプロンプト（プリセットの保存・読込） |
| **ダーク / ライトテーマ** | 美しいテーマ切り替え、スムーズなトランジション |
| **PWAサポート** | あらゆるデバイスでネイティブライクなアプリとしてインストール可能 |
| **ユーザー認証** | JWTベースの安全なログイン・登録 |

<br/>

## 技術スタック

| レイヤー | 技術 |
|:---|:---|
| **フロントエンド** | Next.js 16、React 19、Tailwind CSS、Framer Motion、Ant Design |
| **バックエンド** | Next.js API Routes (Node.js)、SSEストリーミング |
| **データベース** | MongoDB (Mongoose) |
| **ストレージ** | Vercel Blob |
| **AI SDK** | Google GenAI、Anthropic SDK、OpenAI API |
| **サンドボックス** | Vercel Sandbox |
| **デプロイ** | Vercel |

<br/>

## はじめに

### 前提条件

- Node.js 18+
- MongoDBインスタンス
- 使用するAIプロバイダーのAPIキー

### インストール

```bash
# リポジトリをクローン
git clone https://github.com/Noah-Wu66/Vectaix-AI.git
cd Vectaix-AI

# 依存関係をインストール
npm install

# 開発サーバーを起動
npm run dev
```

### 環境変数

デプロイ時に以下の環境変数を設定してください：

| 変数 | 説明 |
|:---|:---|
| `MONGODB_URI` | MongoDB接続文字列 |
| `JWT_SECRET` | JWT認証シークレット |
| `GOOGLE_AI_API_KEY` | Google Gemini APIキー |
| `ANTHROPIC_API_KEY` | Anthropic Claude APIキー |
| `OPENAI_API_KEY` | OpenAI GPT APIキー |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blobストレージトークン |

<br/>

## 研究

本プロジェクトは、論文で紹介された **Council Mode** フレームワークを実装しています：

```bibtex
@article{wu2026council,
  title={Council Mode: Mitigating Hallucination and Bias in LLMs via Multi-Agent Consensus},
  author={Wu, Shuai and Li, Xue and Feng, Yanna and Li, Yufang and Wang, Zhijun},
  journal={arXiv preprint arXiv:2604.02923},
  year={2026}
}
```

### 主要成果

| 指標 | Council Mode | 最良単一モデル | 改善 |
|:---|:---:|:---:|:---:|
| HaluEval（ハルシネーション） | - | - | **相対35.9%削減** |
| TruthfulQA | - | - | **+7.8ポイント** |
| バイアス分散 | - | - | **大幅に低下** |

<br/>

## ライセンス

本プロジェクトは [MITライセンス](LICENSE) の下で公開されています。

<br/>

---

<div align="center">

### Star 推移

[![Star History Chart](https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date)](https://star-history.com/#Noah-Wu66/Vectaix-AI&Date)

<br/>

このプロジェクトが役に立ったら、ぜひStarをお願いします！

[![GitHub stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=social)](https://github.com/Noah-Wu66/Vectaix-AI)

<sub>知性で構築し、合意で駆動する。</sub>

</div>
