# AgentTrail 다중 프로젝트 관측

2026-11-11 KST. 최초 공개 연결은 note:5330과 시험 보드:5331만 실행한 상태였으며, 원본 상단 제목도 note를 표시했습니다. 한 프로젝트만 지원하는 제품이라는 뜻이 아니었습니다.

## 현재 구성

`trail.pydemia.ai`의 같은 화면에서 주요 프로젝트10개와 시험 보드1개를 함께 조회합니다.

| 프로젝트 | 관측 포트 |
| --- | --- |
| note | 5330 |
| agenttrail-benchmark (시험) | 5331 |
| agent-track | 5333 |
| persona (Assistant 소스 포함) | 5334 |
| demian | 5335 |
| projects | 5336 |
| ui | 5337 |
| agent-skills | 5338 |
| portal | 5339 |
| colors | 5340 |
| markyourscope | 5341 |

원본은 저장소별 daemon을 실행하고 `5330–5344`의 15개 포트에서 sibling board를 발견해 `/world`와 `/fleet`으로 합칩니다. 이 구성에서는5332가 인증 gateway이므로 관측용으로 쓰지 않습니다. 기존 서버 Tunnel이나 Entra 권한을 늘리거나 별도 공개 포트를 열지 않았습니다.

동일한 웹 주소의 왼쪽에는 등록 저장소들이 표시되고, 프로젝트를 펼치면 파일 트리를 봅니다. 프로젝트명을 누르면 지도에서 해당 영역으로 이동합니다. runs overlay에는 수집된 세션이 프로젝트와 함께 표시됩니다. `+ add repo`는 **브라우저가 열린 장치가 아닌 이 Windows PC의 경로**를 받아 관측 보드를 추가합니다. `init`·setup은 필요할 때만 별도로 실행하며 이번 구성에서는 각 저장소의 PLAN/AGENTS/CLAUDE를 수정하지 않았습니다.

영구 시작 목록은 [trail-projects.json](../deploy/trail-projects.json)입니다. 새 저장소를 항상 다시 시작하려면 해당 파일에 로컬 폴더명과 비어 있는 범위 내 포트를 추가합니다. 같은 이름·포트, gateway 포트, 없는 폴더는 launcher가 거절합니다. 현재 포트 범위를 넘어서는 무제한 집계는 구현하지 않았습니다.

`Start-Trail.cmd`와 Windows 로그인 Startup은 이 목록의 모든 보드를 확인·시작합니다. 이미 실행된 보드는 재사용하고 예상 저장소·포트가 다르면 중단합니다. 원본 source checkout은 수정하지 않았습니다.

## 원격 화면의 표현 보정

원본 HTML을 gateway에서 제공할 때만 `trail-overview.mjs`가 다음 표시를 보정합니다.

- note로 고정되던 상단·브라우저 제목을 전체 프로젝트 관측 제목과 보드 수로 변경.
- 기본 파일 트리를 접어 note 파일 목록이 다른 프로젝트를 가리지 않도록 변경.
- native 프로젝트·세션·파일 데이터, action token, API와 SSE는 그대로 사용.
- [SNB 반응형 오류 수정·접기·너비 조절](sidebar-layout-fix.md): 원본의 960px 이하 열 너비 역전을 보정하고 프로젝트 버튼·resizer를 추가. 사용자 설정은 브라우저에 보존.

로그인 직후 대표 보드의 SSE가 먼저 도착하고 `/world` polling(2초 간격)이 나머지를 채웁니다. 새 보드 자동 발견은 원본의30초 간격을 따릅니다. 초기 한 보드 표시를 영구 단일 프로젝트 모드로 해석하지 않습니다. source HTML의 대응 코드가 바뀌면 adapter는 잘못된 변환 대신 명시적 오류를 반환하므로 upstream 업데이트 시 재검사가 필요합니다.

## 세션 수집 범위

- 원본은 이 PC의 Codex·Claude Code 로컬 로그를 자동으로 읽습니다. 최근2시간 안에 수정된 로그, 파일당 tail2MiB 등 원본 제한이 적용됩니다.
- 이번 검사에서는 최근 Codex 로그1개가 agent-track을 가리켰으며 집계에도 해당 세션1개가 나타났습니다. 다른 프로젝트의0개는 현재 수집 범위 안에서 감지한 세션이 없다는 뜻입니다.
- Codex 앱의 보관된 모든 대화, 다른 PC/서버에만 존재하는 세션, Assistant·Demian 자체 실행 원장은 자동 수집 대상이 아닙니다. persona·demian 보드는 소스 저장소의 작업을 관측하며 두 앱의 전체 세션을 연동한 결과가 아닙니다.
- pydemia-desktop은 이번 환경에서 소스 위치·세션 API를 확인하지 못해 별도 보드나 session adapter로 추가하지 않았습니다.
- 모든 앱의 작업 관리·명령·장치 간 세션 통합은 Agent Track 기획의 adapter와 공통 원장이 맡아야 합니다.

## 검증

[multirepo-verification.json](multirepo-verification.json): 설정11개, 실제11개 보드 identity·포트·집계 일치와 현재 Codex 세션 관측. `verify-sso.mjs` 및 `verify-public-sso.mjs`로 기존 Entra 인증·Basic 공개 우회 차단·Origin 차단 회귀도 확인했습니다.

Entra 로그인된 실제 브라우저에서 `AgentTrail · 11 projects`와11개 저장소, agent-track의 Codex run 카드를 확인했습니다. persona를 선택해 원격 주소에서 해당 저장소의 apps/packages/scripts/tests 파일 트리가 열리는 것도 확인했습니다. 전체 화면을 새로 고쳐도 프로젝트 목록이 먼저 보이도록 기본 펼침은 제거했습니다.

원본: [AgentTrail README](https://github.com/sodiumsun/agenttrail/blob/3785d4ea62ca58b9ded853b2e4c3b99f12c02c97/README.md), 설치 소스의 `bin/agenttrail.mjs` multi-repo/world/fleet 구현. 원격 표시 보정은 이 저장소 소유이며 원본을 Agent Track 구현으로 간주하지 않습니다.
