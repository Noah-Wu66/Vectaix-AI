<div align="center">

# 🌌 Vectaix AI

### 오픈소스 AI 워크스페이스 — 멀티모델, 멀티전문가, 하나의 플랫폼.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=gold)](https://github.com/Noah-Wu66/Vectaix-AI/stargazers)
[![Forks](https://img.shields.io/github/forks/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=silver)](https://github.com/Noah-Wu66/Vectaix-AI/network/members)
[![Issues](https://img.shields.io/github/issues/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=orange)](https://github.com/Noah-Wu66/Vectaix-AI/issues)
[![Deploy with Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Node](https://img.shields.io/badge/Node-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)

<br/>

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · **한국어**

<br/>

> ⚠️ **초기 버전 안내** — 이 프로젝트는 활발히 개발 중입니다. 기능, API, UI가 자주 변경될 수 있습니다. 지속적인 업데이트와 개선을 약속합니다. 최신 소식을 받으려면 Star를 눌러주세요!

<br/>

<img src="https://img.shields.io/badge/GPT--5.4-412991?style=flat-square&logo=openai&logoColor=white" alt="GPT-5.4" />
<img src="https://img.shields.io/badge/Claude_Opus_4.6-d97706?style=flat-square&logo=anthropic&logoColor=white" alt="Claude" />
<img src="https://img.shields.io/badge/Gemini_3.1_Pro_Preview-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemini" />
<img src="https://img.shields.io/badge/DeepSeek_V3.2-0A0A0A?style=flat-square&logoColor=white" alt="DeepSeek" />
<img src="https://img.shields.io/badge/Seed_2.0_Pro-FF6A00?style=flat-square&logoColor=white" alt="Seed" />

</div>

---

## ✨ Vectaix AI란?

Vectaix AI는 Vercel 클라우드 네이티브 배포를 위해 설계된 **오픈소스 AI 워크스페이스**입니다. 세계 최고의 AI 모델들을 하나의 통합 인터페이스에 모아 — 공식 API 지원과 고유한 멀티전문가 협업 시스템을 제공합니다.

GPT-5.4의 빠른 답변, Claude Opus 4.6의 깊은 추론, 여러 AI 전문가의 토론과 종합 — Vectaix AI가 모두 해결합니다.

---

## 🎯 주요 기능

<table>
<tr>
<td width="50%">

### 🤖 멀티모델 채팅
하나의 워크스페이스에서 8개 AI 모델을 자유롭게 전환. 각 대화에 다른 모델 바인딩 가능.

### 🧠 Council 워크플로우
고유한 멀티전문가 협업 모드: GPT-5.4, Claude Opus 4.6, Gemini 3.1 Pro Preview가 병렬 전문가로 답변하고, Seed 2.0 Pro가 최종 응답을 종합.

### 🔌 공식 연결
모든 모델이 공식 API 또는 공식 배포만 사용하며, 라우트 전환 기능은 제거되었습니다.

</td>
<td width="50%">

### 🌐 웹 검색 & 브라우징
Volcengine API 기반 고급 필터 웹 검색. 콘텐츠 추출이 포함된 완전한 웹 브라우징 세션.

### 📎 파일 업로드 & 파싱
이미지, PDF, Word, Excel, 코드 파일 업로드 및 파싱. Vercel Sandbox의 Python 런타임으로 처리.

### 💭 사고 과정 표시
모델의 추론 과정을 실시간 스트리밍으로 표시하여 AI가 어떻게 생각하는지 투명하게 공개.

</td>
</tr>
</table>

<table>
<tr>
<td width="33%">

### 🔐 인증
이메일/비밀번호 인증, JWT 토큰 + HttpOnly Cookie. 관리자 시스템 지원.

</td>
<td width="33%">

### 🤖 Agent 런타임
명령 엔진, 도구 레지스트리, 오케스트레이터, 상태 직렬화를 갖춘 완전한 Agent 프레임워크.

</td>
<td width="33%">

### 📱 PWA 지원
Web App Manifest, 모바일 최적화 UI. 다크/라이트/시스템 연동 테마 지원.

</td>
</tr>
</table>

---

## 🧩 지원 모델

| 모델 | 제공업체 | 연결 방식 | 특징 |
|:------|:---------|:-------|:-----|
| **GPT-5.4** | OpenAI | 공식 API | 범용 지능, 코딩, 분석 |
| **Claude Opus 4.6** | Anthropic | 공식 API | 깊은 추론, 글쓰기, 안전성 |
| **Gemini 3.1 Pro Preview** | Google | 공식 API | 멀티모달, 긴 컨텍스트 |
| **DeepSeek V3.2** | DeepSeek | 공식 API | 추론, 수학, 코드 |
| **Seed 2.0 Pro** | ByteDance | 공식 API | 중국어, 요약 |
| **MiMo** | Xiaomi | 공식 배포 | 추론, 소형 모델 성능 |
| **MiniMax M2.5** | MiniMax | 공식 API | 다국어 생성, 코딩 |
| **Council** | 멀티모델 | GPT + Claude + Gemini + Seed | 전문가 합의 종합 |

---

## 🏗️ 기술 스택

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

| 레이어 | 기술 |
|:-------|:-----|
| 프레임워크 | Next.js 16 (App Router) |
| 프론트엔드 | React 19, Tailwind CSS 3.4, Ant Design 5, Framer Motion |
| 데이터베이스 | MongoDB (Mongoose 8) |
| 인증 | JWT (jose), bcryptjs, HttpOnly Cookie |
| 파일 스토리지 | Vercel Blob |
| 샌드박스 | @vercel/sandbox (Node 24 + Python 3.13) |
| AI SDK | @anthropic-ai/sdk, Gemini REST, OpenAI REST, Volcengine Seed |
| Markdown | react-markdown + remark-gfm + remark-math + rehype-katex |
| 문서 파싱 | pdf-parse, mammoth, word-extractor, xlsx |

---

## 🚀 배포

Vectaix AI는 **Vercel Pro** 배포용으로 설계되었습니다. 로컬 런타임은 제공되지 않습니다.

### 사전 요구사항

- Vercel Pro 계정
- MongoDB 데이터베이스 (예: MongoDB Atlas)
- 사용할 AI 제공업체의 API 키

### 환경 변수

| 변수 | 필수 | 용도 |
|:-----|:----:|:-----|
| `MONGO_URI` | ✅ | MongoDB 연결 문자열 |
| `JWT_SECRET` | ✅ | 인증 토큰 서명 시크릿 |
| `ADMIN_EMAILS` | ❌ | 관리자 이메일 목록 (쉼표 구분) |
| `OPENAI_API_KEY` | ✅ | OpenAI 공식 API |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic 공식 API |
| `GEMINI_API_KEY` | ✅ | Google Gemini 공식 API |
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek 공식 API |
| `ARK_API_KEY` | ✅ | ByteDance Seed 공식 API |
| `MINIMAX_API_KEY` | ✅ | MiniMax 공식 API |
| `MINIMAX_MODEL_ID` | ❌ | MiniMax 모델 ID, 기본값은 `MiniMax-M2.5` |
| `MIMO_API_BASE_URL` | ✅ | MiMo 배포 서비스 주소, 예: `https://your-mimo-server/v1` |
| `MIMO_API_KEY` | ❌ | MiMo 배포 서비스 키 |
| `MIMO_MODEL_ID` | ❌ | MiMo 배포 모델 ID, 기본값은 `XiaomiMiMo/MiMo-7B-RL-0530` |
| `VOLCENGINE_WEB_SEARCH_API_KEY` | ⬚ | 웹 검색 (현재 선택사항) |

---

## 🗺️ 로드맵

- [x] 8개 AI 모델 멀티모델 채팅
- [x] Council 멀티전문가 워크플로우
- [x] 공식 연결
- [x] 웹 검색 & 브라우징
- [x] 파일 업로드 & 문서 파싱
- [x] Agent 런타임 프레임워크
- [x] 사고 과정 표시
- [x] PWA 지원
- [ ] 더 많은 모델 제공업체
- [ ] 플러그인 / 확장 시스템
- [ ] 음성 입출력
- [ ] 협업 워크스페이스
- [ ] 모바일 네이티브 앱
- [ ] 셀프호스트 Docker 지원

---

## 🤝 기여하기

모든 형태의 기여를 환영합니다! 버그 리포트, 기능 요청, 풀 리퀘스트 — 모든 도움이 소중합니다.

1. 리포지토리 포크
2. 기능 브랜치 생성 (`git checkout -b feature/amazing-feature`)
3. 변경사항 커밋 (`git commit -m 'Add amazing feature'`)
4. 브랜치 푸시 (`git push origin feature/amazing-feature`)
5. 풀 리퀘스트 생성

---

## 📄 라이선스

이 프로젝트는 [MIT 라이선스](LICENSE)에 따라 공개됩니다.

---

<div align="center">

## ⭐ Star 히스토리

<a href="https://star-history.com/#Noah-Wu66/Vectaix-AI&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
 </picture>
</a>

<br/>
<br/>

**Vectaix AI가 유용하다면 ⭐ 를 눌러주세요**

<br/>

[![Star this repo](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=social)](https://github.com/Noah-Wu66/Vectaix-AI)

<br/>

---

<sub>열정으로 구축. 오픈소스로 구동.</sub>

</div>
