# Projects 원본 앱의 Agent Track 실행 요약

Projects 개요·Task 목록·Task 상세에 같은 Project/Task에 명시 연결된 실행을
표시하는 선택적 통합이다. Projects는 업무 상태·revision·수용 조건을 소유하고,
Demian은 실행 상태를 소유한다. Run 성공을 업무 완료로 바꾸지 않는다.

## 적용 범위

- `src/projects/track_context.py`: 기존 로그인·현재 Project/Task ACL을 조회
  전후 검사하는 BFF. owner-bound reader를 다른 native 계정에 빌려주지 않는다.
- `track-context/bridge.mjs`: 서버에서만 shared Node client를 호출한다. 비밀값은
  private file에서 읽고, 전용 Unix socket으로 정해진 GET API만 조회한다.
- `web/src/AgentTrackSummary.tsx`: 같은 origin의 BFF 조회·4초 deadline·직렬
  15초 polling·scope 변경/권한 철회 시 상태 제거. 비밀값·iframe·명령 실행 없음.
- `native.patch`: 기존 API router, 개요, Task 목록·상세에 연결하는 작은 patch.
  업무 행별 N+1 조회 대신 Project 요약 한 번에서 활동 수·상태를 파생한다.

기본값은 disabled다. 운영 opt-in은 현재 소유자와 QA Project 한 개에 한정한다.
다른 계정·Project 지원은 별도 native/Track 인가와 reader 계약을 구성해야 한다.
이 기능의 장애는 원본 업무 편집·대화·실행 경로를 막지 않는다.

## 원본과 재현

`provenance.json`은 운영 source `b313610c…`, 검증한 source archive SHA,
base image, 수정 대상 원본 hash와 Track SDK revision을 기록한다. 원본 Projects
checkout에는 별도 WIP가 있으므로 직접 수정하거나 전체를 배포하지 않았다.
검증한 source archive를 `.runtime/projects-context/source`에 복원하고 독립 Git
baseline을 만든 뒤 이 디렉터리의 새 파일을 복사하고
`git apply --unidiff-zero <native.patch의 절대 경로>`로 patch를 적용한다.

shared `packages/context/{contracts.ts,ExecutionSummary.tsx}`와
`packages/contracts/index.ts`는 `web/src/agent-track-shared/`로 복사한다.
native TypeScript 설정에 맞게 type import의 `.ts` suffix와 쓰지 않는 React
default import만 제거한다. upstream 파일은 수정하지 않는다.
`node scripts/build-context-client.mjs`의 `client.mjs`를 원본 앱의
`track-context/client.mjs`로 복사한다. 브라우저 bundle에 넣지 않는다.

원본 archive에는 배포 template·favicon 검사 script가 빠져 있었다. 검사용
보충 파일의 출처·해시는 별도 검증 기록에 남긴다. 이 파일들은 runtime layer에
들어가지 않는다. 원본 앱의 PostgreSQL 검사는 격리 schema에서만 실행한다.

```powershell
uv run pytest
uv run ruff check src tests migrations
uv run ruff format --check src tests migrations
uv run mypy src/projects
npm --prefix web run check
npm --prefix web run build
```

`scripts/package-projects-context.py --source .runtime/projects-context/source
--output .runtime/projects-context/<새 release>`는 baseline·patch·공유 source·SDK
bundle을 대조하고 표준 frontend build를 실행한다. 입력 변경·예상 밖 staged/
unstaged 변경·packaging 중 산출물 변경을 거부한다. `release.json`에는 build
입력과 payload hash를 기록한다. native source 전체나 비밀 설정은 포함하지 않는다.

## 운영 경계

`PROJECTS_TRACK_CONTEXT_FILE`은 서버의 기존 read-only private mount에 있는
JSON 경로다. version, reader_id, owner_account_id, project_source_id,
project_ids, secret_file, socket_path, public_origin을 지정한다. 키는 별도
0600 파일, socket은 0700 디렉터리 안의 0600 파일이다. PC의 opt-in
`projects-context-bridge.json`이 켜진 경우 기존 watcher가 전용 SSH socket
forward를 유지한다. 공개 포트·Entra 예외·공유 비밀번호를 추가하지 않는다.

`deploy/projects/deploy-context-layer.py`는 exact base image 위에 변경한 API
두 파일·Node bridge/client·새 web dist만 복사한다. private DB dump 검증과
mount backup 후 app만 재생성한다. 기존 DB/edge/oauth2-proxy container ID,
mount·command·user·기존 환경변수를 유지하고 context config 경로 한 개만
추가한다. schema migration은 없으며 실패 시 이전 app을 복원한다. 동시
업무 편집을 막지 않으므로 backup은 online snapshot이다. 배포 전후 업무
fingerprint가 다르면 원본 변경과 구별해 보고하며 자동 DB 복원은 하지 않는다.

운영 이미지의 기존 `ai.pydemia.projects.source` label은 base source를 뜻한다.
새 `ai.pydemia.agent-track.context` label과 release manifest가 이 layer의
payload를 식별한다. 오래된 상속 archive label을 새 source 검증으로 사용하지 않는다.
