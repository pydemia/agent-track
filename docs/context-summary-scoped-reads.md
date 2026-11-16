# Agent Track 원본 실행 요약 복구 — 2026-11-16

Projects 화면의 **실행 기록을 불러오지 못했습니다** 오류를 수정하고 운영에서
확인했다. 현재 Track API는 `cd73f0962c99e7ae1266fe2ef4127a2d31472852`, 웹은
기존 `474676f66f276fafd00c9325e3bfcfb2f30bd78b`다. 기존 인증과 웹 자산을 유지했다.

## 실제 증상과 수정

같은 Task의 원본 요약 API는 정상 JSON을 반환해도20,962ms가 걸렸다. Projects의
요약 클라이언트는2초 제한이어서 결과를 표시하지 못했다. 일반 Native 실행만
읽는 계약에서도 무관한 보호 Assistant 창을 앞뒤로 수집하고 있었다. 해당 수집을
분리하고 현재 Projects 권한과 정확한 Native Run/Session GET은 유지했다.

첫 수정 뒤 Task는1,000ms로 줄었지만 Project 전체는4Run·4Session을 순차 조회해
2,808ms였다. 원본 요청 수와 결과 순서를 유지하며 최대4개씩 함께 조회하도록
수정했으나 Project는 여전히2,321ms였다. 이 중간 결과를 전체 복구로 계산하지 않았다.

후속 측정에서 매 권한 확인이 전체 소유자의1,374Run 관계를 다시 읽고 있었다.
실제 운영 DB를 읽기 전용으로 측정한 전체 투영은203ms·관계 조회1,374회,
해당 reader 출처만의 투영은8ms·관계 조회19회였다. 서비스 reader에 이미 등록된
Native·Projects 출처 범위를 관계 읽기 전에 적용했다. 최신 snapshot을 계속 만들고
reader 변경·원본 권한·배정·후속 명령 필터를 그대로 확인하며 결과 cache는 추가하지 않았다.
일반 소유자 대시보드는 계속 모든 승인 출처를 표시한다.

## 운영 검증

기존2초 제한 클라이언트에서 같은 Task는**281ms·Run1·Session1**, Project는
**215ms·Run4·Session4**로 모두 connected였다. 관측 범위의 unavailable은 false였다.
이는 해당 시점의 실제 표본이며 전체 이력의 완전성을 뜻하지 않는다.

Edge의 기존 Entra 계정으로 Projects에 복귀한 뒤 같은 Task를 확인했다.
Project의 관측 실행4개, 목록별 실행 배지, 선택 Task의 Run1·Session1·성공1개와
Run `82f7e1fd-8fe2-4da1-8307-99f3e016f48c`의 Track 링크가 표시됐다. 원본 Task는
`00418966-a605-411d-89ee-51344526ec42`·revision1·todo로 유지됐다. 실행 성공과
업무 수용을 구분하며 업무를 완료 처리하지 않았다. 기존 오류 문구는 사라졌다.

오래 열린 로그인 요청의 callback은 거절됐다. 원본 Task 주소에서 새 정상 흐름을
시작해 기존 Entra 계정으로 복귀했다. 사용자명·비밀번호 로그인, 새 동의·credential·
권한 생성이나 원본 앱 인증 변경은 수행하지 않았다.

## 검사와 보존

- 무관한 Assistant 실패, 순차 조회, 범위 적용 전 관계 읽기를 각각 수정 전 실패로
  확인했다. 관련10개와 타입 검사가 통과했다. 철회·회전·보호 Run 제외·순서·
  일반 대시보드의 전체 출처 유지도 같은 실제 localhost HTTP 검사에 포함했다.
- [최종 Windows·Ubuntu CI](https://github.com/pydemia/agent-track/actions/runs/43885275813) 성공.
  Windows1,280개 중1,269통과·실패0·환경 제외11개, Ubuntu1,280개 중1,255통과·
  실패0·환경 제외25개였다. CI 환경 제외를 실제 제공자 수용으로 세지 않는다.
- 최종 범위 투영 변경은 독립 읽기 전용 코드 검토에서 수정 필수 지적이 없었다.
  이 검토는 실제 운영·화면 검증을 대신하지 않는다.
- 후보·복구 버전의 사본 기동·원장·스키마·웹18개 파일·종료를 확인했다.
  운영 전환 `514deade-cead-4d56-b566-77a1b8d86ca1` 후 설정47개·다른 프로세스18개,
  Track 이력·저장 보기1개·원본 Native DB·8events 전체 SHA·역사 binding r3를 보존했다.
  익명·위조401과 공개 Track·Trail 로그인 경계도 유지했다.
- 배포 준비의 과거 worker PID는 다른 생성 시각의 프로세스에 재사용돼 있었다.
  기록된 worker identity가 종료됐음을 생성 시각으로 확인했고 다른 프로세스는 건드리지 않았다.

## 남은 goal

상위 수용 **15/21·71.4%**를 유지한다. 이번 결과는 AT-20의 실제 Projects 문맥
조회 복구이며 원본 Demian 브라우저 인증·장애 격리까지 완료한 것은 아니다.
보호 Assistant의 전체 업무 반복 관측, 명령·복구, peer 대표선·같은 대시보드의
다중 장치 확인도 남는다. 전체 필수 하위 결과 분모는 미확정이며 전체 ETA는
산정 불가·신뢰도 낮음이다. reader 운영🟩·일반 Projects 요약🟩,
보호 업무/Trace🟨·명령/복구🟨·peer/다중 장치🟨로 구분한다.

새 Persona source90e0825/image33e19141의 CI 예외 승인은 별도로 대기 중이다.
일반 요약의 불필요한 부하를 제거했으므로 이미 승인된 source4a9ad42의 보호 업무
반복 관측도 다음 재측정 대상으로 둔다. 새 후보의 승인을 임의로 대체하지 않는다.

Linux peer의 이전 QA API·credential은 정리됐고 두 Docker 엔진의 소유 container는
현재0개였다. 실제49events와 SQL 보관본의 기존 SHA는 일치하지만 현재 인가된
연결을 대신하지 않는다. 실제 조회 경계를 마련한 뒤 대표선 포인터와 다중 장치
수용을 확인해야 한다. 새 peer Run·credential·worker는 생성하지 않았다.

[운영·검사 근거](https://github.com/pydemia/agent-track/blob/main/docs/context-summary-scoped-reads-verification.json),
[peer 현재 경계](https://github.com/pydemia/agent-track/blob/main/docs/peer-read-path-availability.json),
[전체 수용표](https://github.com/pydemia/agent-track/blob/main/docs/goal-status.md)를 따른다.
