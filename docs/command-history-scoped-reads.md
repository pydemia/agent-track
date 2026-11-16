# Agent Track 명령 이력 조회 복구 — 2026-11-17

일반 Native 실행의 명령 이력·같은 ID 복구 조회가 무관한 보호 Assistant 수집
실패에 묶이던 문제를 수정해 운영에 반영했다. 실제 명령 이력 GET은 수정 전
15,005ms timeout에서 수정 후916ms·HTTP200으로 복구됐다. 현재 writer는
비활성이며 실제 명령 기록은0개다. 실제 provider 재시도·재개 성공을 주장하지 않는다.

## 원인과 수정 범위

앞선 일반 Trace 조회 분리 뒤에도 `successor-commands` GET은 전체 보호 수집과
전체 소유자 snapshot을 사용했다. 실행 명령 권한이 없는 일반 Run에서도 이력
패널이 불필요한 원격 수집을 기다리고 실패했다.

[수정 source047b4d6](https://github.com/pydemia/agent-track/commit/047b4d61a8e4d803741dfc67031109d2265f1152)은
일반 명령의 GET 목록·개별 ID 복구만 해당 Native와 현재 Projects 범위로 조회한다.
현재 Native Run/Session, Task 권한과 source·actor 재확인은 그대로 수행한다.
보호·미확인 source와 모든 POST는 기존 전체 검사를 유지한다. GET으로 자동
재전송하거나 reader·취소 권한을 writer로 바꾸지 않는다.

회귀 검사에서 수정 전503≠200을 확인했다. 수정 후에는 Native 접수 뒤 응답 유실을
같은 ID의 GET으로 복구해 accepted를 확인하고 POST1회를 유지했다. 쓰기 권한을
거둬도 현재 읽기 권한으로 기존 기록을 조회하고, Task 권한 철회·계정 변경은
기록을 숨긴다. 무관한 보호 수집 실패 중 POST는 기존 경계에서 거절된다.
이 응답 유실·복구 검사는 실제 HTTP/SQLite와 합성 Native를 사용했으며 운영 실행과 구별한다.

## 검증과 운영 화면

관련53개·타입 검사 통과, 독립 정적 검토 필수 수정 지적0개다. 검토자는 검사를
실행하지 않았고 source 회전은 코드를 추적했으며 별도 새 회귀 검사는 추가하지 않았다.
[정확한 커밋의 CI43907688296](https://github.com/pydemia/agent-track/actions/runs/43907688296)는
Windows1,282개 중1,271통과·실패0·환경 제외11개, Ubuntu1,282개 중1,257통과·
실패0·환경 제외25개다.

현재 운영 API는 `047b4d61a8e4d803741dfc67031109d2265f1152`, 웹은 기존
`474676f66f276fafd00c9325e3bfcfb2f30bd78b`다. 전환 operation은
`cdaa24c9-48c7-4d76-bfbe-ab33003ca0aa`다. 후보·복구 버전의 별도 기동과 명령
원장·전체 이력 보존 후 정상 전환했고 원래 설정을 복원했다. bridge는 재시작하지 않았다.

실제 Run `82f7e1fd-8fe2-4da1-8307-99f3e016f48c`의 GET은916ms·200으로
`unsupported/not_enabled`, 명령 기록0개를 반환했다. Edge의 기존 Entra 계정에서
새로고침 후 LIVE와 해당 Run 상세의 ‘현재 계정·출처에 실행 명령 권한이 설정되지
않았습니다’ 문구·같은 기록 조회 버튼을 확인하고 화면을 캡처했다. 명령 버튼을
전송하거나 새 grant·credential·worker·provider Run을 만들지 않았다.

웹18개 파일의 MIME·바이트/hash, 설정47개·다른 프로세스18개, Track 이력과
저장 보기1개·SQLite 무결성, 원본 Native46개 테이블 보존을 확인했다. 보호 Run의
원본8events 전체 metadata SHA·역사 binding r3·cursor8도 유지됐다. 무인증·위조
인증401과 공개 Track/Trail 로그인302를 유지했다. 운영 AgentTrail은 변경하지 않았다.

## Persona 후보 검사 보완과 남은 조건

후보 source90e0825의 Windows 전체 검사 실패 당시 디스크 여유는 압축 복구 CLI의
1GiB 예비 공간보다 작았다. 이번 검사 전 여유는5,106,638,848bytes였다. 같은
깨끗한 source checkout에서 실패했던 파일13개가 통과했고, 이전과 같은 동시 실행
수2의 전체 검사는1,345개 중1,331통과·실패0·환경 제외14개였다. 이전 실패는
보존하며, 이번 결과는 전체 GitHub CI의 browser/native/media job 성공을 대신하지 않는다.

새 Persona source90e0825/image33e19141의 CI는 결제/한도 때문에 검사 시작 전에
실패한 상태이며 정확한 후보의 별도 예외 승인은 대기 중이다. 현재 운영은 사용자가
승인한 source4a9ad42/imageb68ece66이다. 후보를 운영에 반영하지 않았다.

AT-09의 Track 검토·전송·복구 source와 원장 테이블은 현재 운영 release에 있다.
과거 문서의 ‘Track 배포 전’ 설명을 현재 상태로 재사용하지 않는다. 실제 원본의
command-context GET은404였고 일반·보호 writer가 비활성이다. 실제 명령 수용·
응답 유실 복구의 운영 실기와 보호 업무 반복 안정성은 남는다. 원본 Session의
브라우저 이동은 오류 페이지 뒤 제어 도구의 URL 검증 제한으로 미완료이며 인증을
바꾸지 않았다. 실제 peer 조회 경계·다중 장치 대시보드도 남는다.

상위 수용은 **15/21·71.4%, 직전 대비0%p(동일 가중치·부분0)**다. AT-06/09/12/
14/15/20을 유지한다. 읽기 운영🟢, 통합 안정성·명령·그룹/peer·다중 장치🟡다.
전체 필수 하위 분모와 완료 ETA는 산정하지 않는다. 다음 수용 경계는 승인된
후보의 보호 업무 반복 검증, 원본 앱 인증과 실제 peer·명령 실행 범위다.

[검증 기록](https://github.com/pydemia/agent-track/blob/main/docs/command-history-scoped-reads-verification.json),
[전체 수용표](https://github.com/pydemia/agent-track/blob/main/docs/goal-status.md),
[Persona 정확한 후보·검사 보완](https://github.com/pydemia/agent-track/blob/main/docs/projects-read-transport-candidate.json)을 따른다.
