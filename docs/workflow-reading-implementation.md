# 업무 흐름·내용 전달 개선 구현

기준: [R1 기획안](proposals/workflow-reading-v2.md), `d10165f` 공개 source와 현재 운영 Auth 전용 API `ee26566`.
2026-11-21: R1에서 즉시 읽는 내용·선택 범위·흐름을 개선한다. 상세 상태와 검증 결과는 아래에 갱신한다.

## 구현 범위

- WR-02/03: 원본 대화의 Agent 이름·완전한 도구 입력의 파일명으로 표시한다. source/Run/invocation/call의 기존 식별자는 바꾸지 않는다. 하위 Agent는 해당 요청·관측 메시지가 먼저 나오고 전체 Run의 목적·응답은 접힌 문맥으로 둔다.
- WR-04/10: v1 Run 원장의 매 페이지를 기존 BFF로 다시 인가하고 최대 5페이지씩 관련 호출을 탐색한다. 다음 구간·부분·legacy·원문 미제공·조회 오류를 구별한다. 새 scope에서 이전 본문을 즉시 숨기고 실패 시 버린다.
- WR-05/06/09: 기존 ui.pydemia FlowCanvas·원본 그룹·대표선·이전 탐색·저장 보기를 재사용한다. 기본 Trace는 coordinator 내부와 접힌 하위 Agent를 보여주고 모델 요청은 선택한다. Map은 실행 도구 대신 조직·소속 관계를 기본으로 한다. 관계를 새로 추정하지 않는다.
- WR-07/08: 요약·대화·도구·근거 탭을 제공한다. Markdown 읽기·원문 전환, HTML 실행 금지, 링크 프로토콜 제한, 외부 이미지 자동 조회 금지를 적용한다. 이전 시도의 결과 귀속 조건은 기존대로 유지한다.
- WR-01/11/12: Trail에서 요청·Agent 메시지·도구 응답을 직접 읽고 정규 상태 이벤트는 접어서 확인한다. 원본 미연결·검증·수용 미확인을 유지하며 임의 완료율을 추가하지 않는다. 기존 sidebar drag·scroll·favicon을 유지한다.

## 원본 연동과 배포 경계

현재 journal v1에는 host가 보증하는 진행/최종 구분이 없다. 이 구현은 마지막 Agent 메시지를 **관측 메시지**로 표시하며 `최종 응답 미확인`을 유지한다. 메시지 본문의 가짜 marker를 신뢰하지 않는다. invocation 전용 cursor·수집 generation·긴 본문 continuation을 추가한 Native/Persona 새 명세는 후속 producer 변경이다. v1 fallback을 전체 호출 이력 지원으로 표현하지 않는다.

별도 Auth 작업이 공개 main에 없는 두 파일의 private API patch를 운영에 배포했다. 기존 Auth·설정·credential·gateway를 변경하거나 private patch를 공개하지 않는다. UI 배포 후보는 검증된 **현재 동결 API·의존성**을 그대로 보존하고 새 web만 같은 새 release에 넣는다. manifest에서 API revision과 web revision을 각각 기록한다. 운영 `dist/web` 복구본은 보존한다.

화면의 Agent 이름은 수집한 현재 페이지에서 확인되는 경우에 표시한다. 다른 페이지에만 있는 이름을 얻기 위해 전체 원문을 일괄 다운로드하지 않는다. 없는 경우 `Agent · 이름 미제공`을 사용한다.

## 검증 상태

- 관련 회귀 36개 통과: 정확한 호출 귀속, 잘못된 시도·권한 철회, 뒤쪽 페이지 탐색·횟수 제한·cursor 순환, 원문 형식·안전한 링크와 Map/Trace 분리, 그룹 내부 범위·경계 관계 보존, journal 미지원 로컬 도구 본문 fallback.
- 타입 검사·별도 경로 build 통과. 기본 전체 병렬 검사는 OS 메모리 부족과 기존 Windows process inspector의 PowerShell timeout으로 완료하지 못했다. 동시 실행 수 2로 재검사 중이다.
- 실제 운영 Demian 업무를 읽는 후보 화면에서 Agent 선택·하위 대화 분리·도구 입력/응답·원문 전환·키보드 상세 탭·기술 근거 선택·Map/Trail·900/390px 넘침 없음·favicon 경로/MIME를 확인했다. API 조회는 현재 private SSO 매핑을 사용한 loopback 검사이며 공개 브라우저의 사용자 로그인 검증과 구분한다.
- Assistant/보호 Persona는 현재 운영 출처가 disconnected다. 그 경로의 새 실기 완료로 표시하지 않으며 시도 분리·철회 회귀는 격리 HTTP 검사 결과다.
- PR #7의 Windows·Ubuntu CI 통과. Windows PR 실행에서 기존 coordinator 가용성 검사가 한 번 실패했고 같은 source의 push 실행과 실패 job 재실행은 통과했다. 생산 코드의 제한 시간·인가 조건은 변경하지 않았다.
- 자동 리뷰의 로컬 Codex 도구 본문 누락은 확인한 회귀다. 선택 call의 입력·출력을 기존 본문 reader에서 다시 제공하고 invocation 귀속을 보증할 수 없는 범위에는 붙이지 않는다. 입력/출력 종류를 추정하지 않는다. 운영 배포 전 후속 수정과 검사를 수행한다.
- 최종 운영 전환은 진행 중이다.

## 남은 R1 수용 범위

원본 host 최종 marker·호출 전용 paging, 다중 기기 handoff 실기와 screen reader 검수, 사용자의 이해도 비교 측정은 이번 UI 구현의 완료로 계산하지 않는다. 원본이 제공하지 않는 결과·의존성·진척을 추정해 채우지 않는다.
