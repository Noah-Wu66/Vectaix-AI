<div align="center">

# 🌌 Vectaix AI

### 오픈소스 AI 워크스페이스 — 멀티 전문가 평의회 및 자율형 Agent를 위한 듀얼 엔진 아키텍처

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=gold)](https://github.com/Noah-Wu66/Vectaix-AI/stargazers)
[![Deploy with Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Node](https://img.shields.io/badge/Node-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)

<br/>

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · **한국어**

[📄 기술 아키텍처 백서 읽기 (Architecture Paper)](./ARCHITECTURE.md)

<br/>

> ⚠️ **초기 버전 안내** — 이 프로젝트는 활발히 개발 중입니다. 기능, API, UI가 자주 변경될 수 있습니다. 최신 소식을 받으려면 Star를 눌러주세요!

<br/>

<img src="https://img.shields.io/badge/GPT--5.4-412991?style=flat-square&logo=openai&logoColor=white" alt="GPT-5.4" />
<img src="https://img.shields.io/badge/Claude_Opus_4.6-d97706?style=flat-square&logo=anthropic&logoColor=white" alt="Claude" />
<img src="https://img.shields.io/badge/Gemini_3.1_Pro_Preview-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemini" />
<img src="https://img.shields.io/badge/DeepSeek_V3.2-0A0A0A?style=flat-square&logoColor=white" alt="DeepSeek" />
<img src="https://img.shields.io/badge/Seed_2.0_Pro-FF6A00?style=flat-square&logoColor=white" alt="Seed" />

</div>

---

## ✨ Vectaix AI란?

Vectaix AI는 Vercel 클라우드 네이티브 배포를 위해 설계된 **오픈소스 AI 워크스페이스**입니다. 세계 최고의 AI 모델들을 하나의 통합 인터페이스에 모아 견고한 [듀얼 엔진 아키텍처 (Dual-Engine Architecture)](./ARCHITECTURE.ko.md)로 구동합니다.

GPT-5.4의 빠른 답변, Claude Opus 4.6의 깊은 추론, 또는 여러 AI 전문가의 토론을 통한 최종 답변 통합 등 Vectaix AI는 세련되고 전문적인 경험을 제공합니다.

### 🖼️ 인터페이스 미리보기

*(여기에 채팅 인터페이스 스크린샷 또는 GIF를 삽입하세요)*

---

## 🎯 주요 기능

<table>
<tr>
<td width="50%">

### 🧠 Council 워크플로우 (멀티 전문가)
여러 모델(예: GPT, Claude, Gemini)이 병렬 전문가로서 쿼리를 추론하고 최종 모델이 합의를 통합하는 고유한 협업 모드입니다.
[수식 및 아키텍처 다이어그램 읽기](./ARCHITECTURE.md#11-the-council-module-multi-expert-consensus)

### 🤖 Agent 런타임
자율적인 작업 실행을 위한 명령 엔진, 도구 레지스트리 및 상태 직렬화를 갖춘 완전히 격리된 오케스트레이션 계층입니다.
[Agent 아키텍처 다이어그램 보기](./ARCHITECTURE.md#12-the-agent-module-autonomous-orchestration)

### 🔌 공식 API 통합
최대 안정성과 성능을 보장하기 위해 모든 모델은 공식 API 또는 공식 배포를 통해 통합됩니다.

</td>
<td width="50%">

### 🌐 웹 검색 & 브라우징
Volcengine의 실시간 인덱싱 API를 활용한 Grounded 생성. 완전한 웹 브라우징 세션 및 콘텐츠 추출 포함.

### 📎 멀티모달 문서 파싱
이미지, PDF, Word, Excel 및 코드 파일 업로드 및 파싱. Vercel Sandbox의 Python 런타임을 통해 비동기적으로 처리.

### 💭 실시간 사고 과정
모델의 내부 추론 과정을 실시간 스트리밍으로 표시하여 AI가 어떻게 결론을 도출하는지 투명하게 공개.

</td>
</tr>
</table>

---

## 🏗️ 기술 스택

<table>
<tr>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=nextjs" width="48" height="48" alt="Next.js" /><br><sub>Next.js 16</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=react" width="48" height="48" alt="React" /><br><sub>React 19</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=tailwind" width="48" height="48" alt="Tailwind" /><br><sub>Tailwind CSS</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=mongodb" width="48" height="48" 단어="MongoDB" /><br><sub>MongoDB</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=vercel" width="48" height="48" alt="Vercel" /><br><sub>Vercel</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=nodejs" width="48" height="48" alt="Node.js" /><br><sub>Node 24</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=python" width="48" height="48" alt="Python" /><br><sub>Python 3.13</sub><br></td>
</tr>
</table>

---

## 🚀 배포

Vectaix AI는 **Vercel Pro** 서버리스 배포용으로 설계되었습니다. 높은 동시성과 유지 보수가 필요 없는 확장을 보장합니다.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNoah-Wu66%2FVectaix-AI)

### 환경 변수

| 변수 | 필수 | 용도 |
|:-----|:----:|:-----|
| `MONGO_URI` | ✅ | 상태 저장 메모리를 위한 MongoDB 연결 문자열 |
| `JWT_SECRET` | ✅ | 세션 확인을 위한 암호화 시크릿 |
| `ADMIN_EMAILS` | ❌ | 관리자 이메일 목록 (쉼표 구분) |
| `OPENAI_API_KEY` | ✅ | OpenAI 공식 API |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic 공식 API |
| `GEMINI_API_KEY` | ✅ | Google Gemini 공식 API |
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek 공식 API |
| `ARK_API_KEY` | ✅ | ByteDance Seed 공식 API |
| `MINIMAX_API_KEY` | ✅ | MiniMax 공식 API |
| `MIMO_API_BASE_URL` | ✅ | MiMo 배포 서비스 주소 |
| `VOLCENGINE_WEB_SEARCH_API_KEY` | ⬚ | 웹 검색 기능 |

---

## 🗺️ 로드맵

- [x] 8개 AI 모델 멀티모델 채팅
- [x] 듀얼 엔진: Council 워크플로우 & Agent 런타임
- [x] 웹 검색 & 멀티모달 문서 파싱
- [x] 실시간 추론 (Thinking Blocks) 표시
- [ ] 플러그인 / 확장 시스템 확대
- [ ] 협업 워크스페이스
- [ ] 셀프호스트 Docker 지원

---

## 🤝 기여 및 라이선스

모든 형태의 기여를 환영합니다! 리포지토리를 포크하고 풀 리퀘스트를 열어주세요.

이 프로젝트는 [MIT 라이선스](LICENSE)에 따라 공개됩니다.

<div align="center">

## ⭐ Star 히스토리

<a href="https://star-history.com/#Noah-Wu66/Vectaix-AI&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
 </picture>
</a>

</div>