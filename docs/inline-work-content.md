# Track 안에서 읽는 업무와 실행 내용

사용자 요구(2026-11-19): 외부 앱 이동 없이 node를 선택해 업무 목적, 세부 작업, 대화·응답, 선택한 실행 시도의 실패 원인을 확인한다. AgentTrail처럼 제목만으로 작업을 구분하고 업무와 세부 작업을 계층적으로 읽는다.

수용 조건:

1. 현재 허용된 업무와 정확한 시도의 요청·응답·실패 내용을 요청 시 조회한다. 과거 실패 시도에 최신 성공 결과를 붙이지 않는다.
2. Run·Assistant·업무 node 선택 시 상세 패널에서 목적 → 수행 작업 → 결과/실패 → 대화를 읽는다. 식별자는 보조 정보로 접는다.
3. 이름은 원본 Task·역할·요청에서 가져온다. 출처에 설명이 없으면 미기록으로 표시하며 UUID로 의미를 대신하거나 업무 수행 내용을 추정하지 않는다.
4. 원본 Project/소유자/역할·시도/Native 권한을 읽기 전후 확인한다. 본문을 Track 원장에 저장하지 않으며 선택·계정·권한 변경과 늦은 응답을 차단한다.
5. 실제 기존 성공·실패 시도와 의미 있는 내용/권한/브라우저 회귀 검사로 확인하고 API와 화면을 함께 반영한다.

참조: AgentTrail의 `public/index.html`의 component/task 제목, `bin/lib/panel.mjs`의 현재 작업·도구·경로 구분, 계획 convention의 동사 중심 구체적 제목과 component 내부 task 구조. 원본 AgentTrail은 수정하지 않는다. Track의 기존 pydemia FlowCanvas/edge/group을 재사용한다.

구현 범위: 별도 본문 reader와 안전한 본문 계약, Assistant 시도별 reader 확장, 일반 Demian·허용된 Codex turn reader, node 상세 패널과 업무 중심 제목·내용 node. 실제 계획/단계를 제공하지 않는 출처에서 의존 관계나 완료를 만들어내지 않는다.

원본 Demian DB/runtime/인증은 변경하지 않는다. Assistant의 격리된 source에서 기존 owner/source fence를 재사용한 읽기 경로만 확장하며 새 Run·모델·writer 권한은 필요 없다.

## 표시와 읽기 범위

- Trace/Map의 요청·수행 작업·응답·실패 node와 선택 패널에 같은 시도의 내용을 연결한다. 계획 순서는 의존 관계로 승격하지 않는다. 기존 역할/시도/Run group과 하위 묶음 경계를 유지한다.
- Assistant·업무 node에서는 명시적으로 연결된 시도 목록에서 대상을 고른다. 실행을 하나로 추정하거나 동일 Session의 다른 응답을 가져오지 않는다. 업무 node의 현재 Projects 설명과 실행 당시 요청·수용 기준을 구분한다.
- Track/Trail의 실행 상세에서도 본문을 읽는다. 일반 Demian과 Assistant Native는 해당 시도의 요청·최종 응답·원본 오류를 제공한다. 현재 reader가 제공하지 않는 중간 대화·도구 본문은 미제공으로 표시한다. Codex는 허용된 저장소의 정확한 턴에서 사용자·assistant·도구 메시지와 보고된 계획을 읽으며 내부 추론·시스템 기록은 제외한다.
- 본문은 항목당 32,000자, 메시지 80개/총 128,000자 한도를 명시한다. 잘린 내용은 부분 조회로 표시한다. 외부 HTML은 문자열로 표시하며 실행하지 않는다. 본문을 영속 원장·브라우저 저장소에 저장하지 않는다.

## 검증 기록

- Track 관련 회귀 214개(실제 Persona producer/client 직렬화 통합 포함)와 추가 HTTP/오류·actor 변경/잘못된 시도/Unicode 회귀 확인.
- Assistant reader·coordinator·Native gateway 174개 통과. query-only SQLite에서 원장 변경과 새 dispatch 없이 실제 Native 응답을 조회하는 조건 포함.
- 두 저장소 typecheck와 별도 산출물 build 통과. Assistant의 서버 전용 계약 subpath를 사용해 기존 웹 compiled 파일의 byte 변경 없음 확인.
- Edge headless 1440×1000, 900×1000에서 합성 본문과 실제 metadata로 node 선택·실패/성공 시도 분리·거부 후 제거·HTML 문자열 표시·가로 넘침 없음 확인. 합성 UI 검증을 운영 본문 검증으로 간주하지 않는다.
- 운영의 실제 기존 실패·성공 시도 및 paired API/web 반영은 현재 후보 검증·전환 증거를 별도로 대조한다. GitHub Persona CI는 결제/사용 한도 때문에 step 0에서 중단됐으며 로컬 통과로 CI 성공을 대신하지 않는다.
