# Agent Track 구현 goal 기준표

기준: 2026-11-11 KST. 기존 AT-01~17을 유지하고 Demian 대화
`01a1c901-2cea-7a21-9b38-8d12445f0a49`에서 AT-18~21을 추가했다.
전체 수용 충족률은 동일 가중치 21개 중 검증 완료 개수다. 이는 작업량
추정치가 아니다. 구현·fixture·서비스 준비만으로 실기 조건을 완료 처리하지 않는다.

| 요구 | 수용 조건 | 상태·증거 |
| --- | --- | --- |
| AT-01 | 원본 ID·재수신·충돌 방지 | 검증 완료. `tests/core.test.ts` ID/충돌·dedupe·재시작·binding 검사, 실제 Codex 211 Run의 source/run UNIQUE 원장 |
| AT-02 | snapshot과 실시간 실행 상태 일치 | 미착수 |
| AT-03 | durable cursor·중복·역순·gap·재시작 복구 | 미착수 |
| AT-04 | Trail·파일·산출물 근거와 수집 범위 | 미착수 |
| AT-05 | 실제 Run·step·tool Trace, unknown 보존 | 미착수 |
| AT-06 | 동일 원본 선택 deep link와 미지원 안내 | 미착수 |
| AT-07 | 계정/프로젝트 권한 교집합·metadata allowlist | 미착수 |
| AT-08 | 네 화면·빈/오류·접근성·favicon 실기 | 미착수 |
| AT-09 | capability 기반 명령·idempotency·receipt·단절 | 미착수 |
| AT-10 | 범위·만료·철회·runtime 재검증 승인 | 미착수 |
| AT-11 | 원본 업무 생성/배정·수락 확인·실패 보존 | 미착수 |
| AT-12 | typed Map·근거·목록·순환/고립 | 미착수 |
| AT-13 | 보존·backup/restore·cursor/receipt 정합 | 미착수 |
| AT-14 | Assistant→Demian→desktop→Track 실제 업무 | 미착수 |
| AT-15 | 전체 프로젝트 기본·필터·장치/수집 누락 | 미착수 |
| AT-16 | SNB 접힘/크기/키보드/보존/모바일 실기 | 검증 완료. CUA 로컬 QA 960px: sidebar244/main700→접힘main944; pointer272·keyboard+4·reload272; 390px drawer340·Tab 순환·Escape focus 복귀 |
| AT-17 | Track Entra 로그인/API/SSE/logout·공개 Basic 차단 | 설정 준비, 제품 미검증 |
| AT-18 | invocation/cowork/managed-child/peer를 구별·고유 Run 집계 | source 조사, 제품 미검증 |
| AT-19 | Projects 원본·Run 단위 binding 이력·서로 다른 완료 | source 조사, 제품 미검증 |
| AT-20 | Demian/Projects 문맥 요약·인증 조회·Track 장애 격리 | 기획, 제품 미검증 |
| AT-21 | 실제 Demian 실행을 Track에서 관측하고 재접속 대조 | 미착수 |

현재 전체: **2/21 (9.5%)**. 직전 1/21 → +4.7%p. ID·중복/충돌 방지
계약·지속 원장·SNB 실기를 검사했다. 전체 일정 신뢰도 낮음. 전역 Demian feed, Projects
외부 실행 참조, Assistant Track 읽기 principal이 기존 API에는 없고 desktop
위치가 미확인이다. 다음 재산정은 계약/첫 실행 adapter 검사 후다.

## 실행 순서

1. Demian-first: string int64 계약, metadata allowlist, durable SQLite 원장,
   Run snapshot·SSE adapter·binding 이력. 단독 실행도 업무 미연결로 수용.
2. 전체 Track, Trail, Trace, typed 실행 Map 및 목록, SNB·상태·deep link.
3. 실제 Demian 실행 연결, 보존/복구, Entra 제품 배포.
4. Projects 업무/권한·요약 연결, Demian 문맥 요약, Assistant/desktop
   계약·연결. 지원하지 않는 기능은 capability에 표시.
5. 명령/승인·업무 생성/배정의 source acceptance, 교차 앱 실기·운영 검증.

Projects가 Project/Task·수용 조건을 소유하고, Demian이 Session/Run·실행
권한을 소유한다. Track은 조회 투영·binding·명령 receipt를 소유한다.
Track 장애는 원본 대화/업무 편집을 막지 않아야 한다. AgentTrail 운영은
보존한다. 개인정보 원문·tool arguments·provider identity는 기본 수집하지 않는다.
