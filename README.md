# Agent Track

Assistant·Demian·pydemia-desktop의 실시간 Agent 실행·작업 관리 대시보드.

| 영역 | 역할 |
| --- | --- |
| Track | 지금 진행 중인 업무, 실행, 승인 요청과 다음 행동 |
| Trail | 작업 이력, 파일 변경, 산출물과 인계 |
| Trace | 실행 단계, 도구 호출, 오류와 성능 근거 |
| Map | 프로젝트, 목표, 작업, 세션과 의존 관계 |

- 제품 주소: https://track.pydemia.ai — Entra 로그인·실제 Demian 실행 관측 배포/검증
- 벤치마크 앱: https://trail.pydemia.ai — 원본 AgentTrail의 보호된 원격 접속
- [제품 기획안](docs/product-plan.md)
- [단계별 개발계획·작업 목록·현재 상태](docs/development-plan.md)
- [화면 시안](docs/prototype.html) — 예시 데이터로 동작하는 검토용 HTML
- [AgentTrail 운영 안내](docs/trail-operations.md)
- [Entra ID 기본 인증 구성·활성화 상태](docs/entra-sso.md)
- [다중 프로젝트 관측·세션 수집 범위](docs/multi-project-overview.md)

Agent Track은 [sodiumsun/agenttrail](https://github.com/sodiumsun/agenttrail)을
벤치마크하는 독립 제품입니다. Demian 실행을 먼저 연결하고 Projects가 업무
원본을 유지하도록 설계했습니다. 현재 제품은 실제 실행 조회와 단일 소유자의 Demian 취소를 지원하는 단계입니다.
전체 실행 관리 goal의 달성 상태는 [수용 기준표](docs/goal-status.md)에 있습니다.

## 실행

Node 24 LTS가 필요합니다.

```powershell
npm ci
npm test
npm run typecheck
npm run build
$env:TRACK_CONFIG = 'C:/private/track-product.config.json'
npm start
```

[설정 예시](deploy/track/config.example.json)를 비공개 경로에 복사해 경로·계정을
설정합니다. 공개 환경은 Entra proxy key와 허용 계정을 모두 검증합니다.
비밀값·source token·DB는 Git에 두지 않습니다. `auth.mode=local`은 명시한
로컬 개발 환경만 허용하며 공개 Host나 전달 identity를 신뢰하지 않습니다.

## 현재 지원 범위

- SQLite 이벤트 원장, string int64 cursor, 중복·역순·누락·재시작 검사.
- Demian Run/Session snapshot·per-Run SSE adapter·허용된 세션의 Run 이력 탐색. 기존 private credential 참조·실제 Run 수집/공개 Trace 검증.
- Codex 로컬 metadata 수집: 허용 저장소·기간·파일 수 한계 표시, 대화와 도구
  입출력 저장 제외. 이것은 Demian native 또는 desktop bridge 연결과 별개입니다.
- Projects 원본 읽기: 전용 소유자 principal·현재 Project ACL로 실제 업무 제목/revision/상태 조회, 접근 축소 시 관련 metadata 비노출. 등록·배정은 후속 단계입니다.
- native Run별 산출물 metadata: 현재 원본 인가와 Run ID를 대조하고, 최근 목록 범위·철회·원문 제외를 표시합니다.
- 실제 원장을 조회하는 Track·Trail·Trace·typed 관계 목록, 전체 저장소 필터,
  URL 선택 복원, 접힘·너비 조절 SNB·모바일 drawer.
- 온라인 backup·검사와 백업 선행 archive. 실행 명령·승인·Projects/Assistant/
  desktop native 연결은 후속 작업이며 미지원 기능을 성공으로 표시하지 않습니다.

[실제 API 계약 조사](docs/integration-contracts.md),
[제품 운영·복구](docs/track-operations.md),
[구현 QA와 한계](docs/implementation-qa.md)를 함께 확인하세요.
