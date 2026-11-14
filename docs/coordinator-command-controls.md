# 보호 실행의 조정자 명령·복구

## 구현 범위

보호된 Demian Run의 실패 재시도·중단 재개를 Assistant 조정자에게 요청한다.
기존 일반 Native의 후속 실행과 별도 원장·권한·API·화면을 사용한다. 기본은
비활성이며, reader credential이나 취소 권한을 writer로 사용하지 않는다.

원본 producer는 Persona `32176e985b38317b4d39fcaf558393045f964232`의
전용 writer 경로다. [PR #22](https://github.com/pydemia/persona/pull/22)에
계약·원본 검사·감사 기록을 반영했다. 소스 게시와 운영 활성화는 별개다.

## 사용자 동작

1. 현재 선택한 Run과 조정자의 현재 역할·시도·operationId·Session·workspace를
   대조한다. 역할이 이미 새 Run으로 이동했다면 과거 Run의 재실행은 잠긴다.
2. ‘요청 검토’는 영속 검토를 저장하며 원본 명령을 전송하지 않는다. 현재
   execution revision과 Task 연결·revision, 출처·계정 범위를 함께 고정한다.
3. ‘확인하고 조정자에 전송’에서 SQLite CAS로 한 번만 전송을 시작한다.
   조정자는 현재 Note·Projects 원문·Task 상태·역할·grant를 다시 검사한다.
4. 저장된 조정자 intent는 `intent_saved`다. **Demian 접수·후속 Run 관측·실행
   성공·Projects 수용 완료와 다르다.** 실제 시도와 연결은 기존 reader의
   역할 이력과 Flow·Trail·Trace·Map 관측으로 확인한다.
5. 응답이 유실되거나 API가 재시작돼도 같은 operationId를 GET으로만 조회한다.
   결과가 없거나 조회에 실패하면 미확정으로 유지하고 새 요청을 잠근다.
   POST 자동 재전송이나 operationId 자동 교체는 없다.

미전송 검토는 현재 소유자의 읽기 범위에서 폐기할 수 있다. 역할 상태가 바뀌거나
새 전송 권한을 거둔 뒤에도 미전송 요청을 거절할 수 있게 한다. 이미 전송을
시작한 요청은 폐기로 재전송 가능 상태가 되지 않는다.

## 원장과 현재 권한

`coordinator_command_intents`는 actor·ID와 조정자 source·execution·role을
고정한다. 같은 역할의 unresolved 요청은 서로 다른 Run에서도 한 건으로 제한한다.
같은 ID의 다른 내용은 거부한다. 검토 기한은 최대 120초다.

`prepared → dispatching → intent_saved / unknown`으로 진행하며, 전송 전
실패가 입증된 경우에만 rejected/expired로 닫는다. 동시 GET이 dispatching을
unknown으로 옮겨도 전송하지 않았다는 claimant의 근거를 보존한다. 반대로 원본의
저장 receipt가 확보됐다면 이 근거를 후속 오류로 덮어쓰지 않는다.

공개 DTO에는 상태·안전한 식별자·조정자 receipt만 담는다. credential, 입력 원문,
서명·권한 digest, source fingerprint는 응답에 포함하지 않는다. 현재 계정과
Origin을 모든 mutation 경계에서 확인하며, credential I/O와 capability 조회가
끝난 뒤 fetch 직전에도 로컬 계정·설정·선택 범위·deadline을 동기로 확인한다.

과거 요청 조회는 현재 원본 권한을 요구하되, 이후 역할·Task revision의 정상
진행으로 기존 receipt를 새 실행에 재지정하지 않는다. 목록 내부에서만 현재
소유자·Run의 read scope를 공유하고 최종 원본 인가를 새로 확인한다. 요청 간
cache는 없으며 쓰기와 개별 receipt 조회는 이 최적화를 사용하지 않는다.
기록 5개의 원본 execution 조회는 availability를 포함해 18회에서 3회로 줄었다.

## API와 운영 준비

- `GET /api/runs/:runKey/coordinator-commands`: 현재 가능 동작과 최대 100개 기록
- `POST .../reviews`: 검토 저장
- `POST .../:id/dispatch`: 명시적 한 번 전송
- `POST .../:id/discard`: 미전송 검토 폐기
- `GET .../:id`: 같은 ID의 현재 원본 저장 결과 복구

`assistantCommandUsers: []`는 credential과 reader 구성을 유지하면서 새 전송을
잠근다. 운영 전환의 maintenance 검사는 일반 `runCommandUsers`와 이 grant를
함께 잠그고, 새 두 원장의 dispatching 상태를 drain 대상에 포함한다. prepared와
unknown 원장을 삭제하거나 임의의 재전송 상태로 바꾸지 않는다.

새 API·프런트엔드·원장 테이블을 함께 배포해야 한다. 현재 동결 운영 release와
원본 Demian DB·runtime·인증·AgentTrail은 이 소스 변경으로 교체하지 않았다.
writer grant나 credential을 생성하지 않았고, 기본 Entra 로그인도 변경하지 않았다.

## 검증 경계

최종 전체 1,167개 중 1,157통과·실패0·기존10skip, 관련 명령/HTTP/client36개
통과와 타입·별도 웹 build를 확인했다. 실제 운영 배포의 성공 판정은 아니다.

실제 로컬 HTTP·SQLite·credential 파일로 단일 전송, 응답 유실, API 재시작,
역할 이동 뒤 같은 ID 복구, 과거 Run 거부, Origin·권한 철회와 최종 batch 인가를
검사했다. 원본 조정자·Projects·Note의 업무 자료와 모델 실행은 합성 port이며
운영 전체 업무 성공으로 계산하지 않는다.

별도 합성 브라우저 화면에서 검토 시 전송 0회, 확인 후 1회·요청 저장 표시,
응답 유실 뒤 같은 ID의 저장 결과와 전송 1회 유지, 권한 만료 시 기록 제거·버튼
잠금을 DOM으로 확인했다. CDP screenshot은 timeout으로 실패했으므로 화면 이미지와
배치·가로 넘침의 시각 검수는 미검증이다. 기존 로그인 handoff 탭도 현재 존재하지
않아 로그인 완료로 간주하지 않는다. 실제 PC의 인증된 운영 화면 검수는 남아 있다.
