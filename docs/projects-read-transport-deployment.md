# Persona 예외 배포와 보호 업무 재검증 — 2026-11-17

사용자가 승인한 Persona source `90e0825` / image `33e19141`을 운영에
배포했다. 기존 DB·인증 정보를 복원하거나 새 credential을 만들지 않았고,
writer와 worker는 활성화하지 않았다. Track API047b4d6·web474676f는 유지했다.

보호 업무의 snapshot·events·evidence를 3회씩 조회한 9개 요청은 모두200이었다.
그러나 90초 SSE 관측26개 중2개에서 보호 출처가 끊기고 대상 Run이 숨겨졌다.
따라서 배포는 완료했지만 전체 업무의 반복 안정성은 아직 수용하지 않는다.

## 배포와 보존

- 운영 source: `90e082510adee7e8e29c058490066cb86efcfdcc`
- 운영 image: `sha256:33e191418c96de6f95f6451c910c2ac3378889b566e3d3734cc1d371c8a0e449`
- 전환 operation: `89aa1266-d2a6-4fce-9b05-d723dc9a9f09`
- 새 컨테이너: `c2aa189f…`, PID1894170, 기동2026-11-17 02:49:34 KST
- 추가 설정: `PERSONA_PROJECTS_READ_TRANSPORT_ORIGIN=http://172.25.0.1:14325`
- 기존 bridge를 유지하는 사설 GET relay를 사용한다. 무인증401·POST405·범위 밖403,
  기존 컨테이너에서의 도달성을 확인했다. 공개 listener나 인증 우회를 추가하지 않았다.

새 work45.7MB·runtime5.2GB 백업을 암호화하고 각각 독립 복원해 검증했다.
runtime 백업·검증까지 약12분48초가 걸렸다. 격리 사본에서 새 이미지와 이전
이미지 모두 health200·인증 없는 조회401·인증된 조회200·controls=false였다.
이전 운영 컨테이너5f12b1f4와 암호화 백업은 보존했다. 실제 운영 롤백은 실행하지
않았고, 현재 계획을 고정한 복구 절차의 읽기 전용 사전 검사만 통과했다.

다른13개 원격 구성 요소와 설정33/32/3개, 로컬 Track 설정47개·다른 프로세스18개,
웹18개 파일의 바이트/hash·MIME, Track 이력·SQLite 무결성을 확인했다.
work33개·runtime65개 테이블에 새 테이블은 없다. work 업무 행은 보존됐고,
runtime은 기동 때 갱신되는 기존3개 Task revision과6개 이벤트만 허용했다.
각 이벤트의 전체 payload와 변경 역산을 검증했으며 보고·기존6개 산출물도 보존됐다.
새 운영 프로세스의 재시작 없는 boot adoption도 확인했다.

검사 준비 중 SQLite 행의 null prototype과 JSON 객체의 형식 차이로 잘못 실패한
비교식은 양쪽 내용을 같은 JSON 형식으로 변환해 수정했다. 별도로 검증용 정적
파일의 읽기 권한도 수정했다. 실패 기록은 보존했고 운영 데이터나 권한 검사를
완화하지 않았다. 새 이미지가 기동된 사본을 이어 검사해 중복 기동을 피했다.
검증 후 이번 작업이 만든 QA 사본 볼륨3개만 정리했고 운영 볼륨·이전 작업은 보존했다.

Persona의 원래 GitHub CI는 결제/한도 사유로 **검사 시작 전 실패**했다.
이번 예외 승인을 CI 성공으로 기록하지 않는다. 별도 clone 검증 helper
b938b3a의 양 OS CI43916233590, 관련19개와 Python 전체53개 검사는 통과했다.
앞선 Persona 후보의 Windows·Linux 후속 검사와 운영 실기 결과도 각각 구별한다.

## 동일 보호 업무의 반복 결과

대상은 Run `60cca68d-95d1-4d99-963a-c2554e0df347`,
WorkExecution `f8a9e44f-a45a-4e33-a87d-a238c5039fde`다.
현재 Projects Task는 revision5·in_review였고, 과거 Run의 연결 revision3은 유지했다.
Task를 완료하거나 수용하지 않았다.

| 회차 | snapshot | events | evidence |
| --- | --- | --- | --- |
| 1 | 200 · 1,852ms | 200 · 2,281ms | 200 · 2,353ms |
| 2 | 200 · 1,653ms | 200 · 2,006ms | 200 · 2,294ms |
| 3 | 200 · 4,969ms | 200 · 2,397ms | 200 · 3,752ms |

모든 events 조회에서 기존8개 metadata의 SHA256은
`dc8f4af8af4009f653280130f6fba752cd4237197ecfb790867b22a1b6c18f15`로
일치했다. 상세는 같은 execution·8events·cursor8/8·모델gpt-6.1-sol(seq3),
usage 관측4개/범위2개, lineage seq4·5, 산출물1개·시간 구간2개를 반환했다.
모델 요청 종료나 실제 응답 모델을 새로 확인한 것은 아니다.

기존 Edge Entra 계정에서 Trace를 열었다. 최초 이벤트 조회404와 일시적인 출처
실패 뒤 선택 해제를 관측했다. 실행을 다시 선택하자8events·4nodes/3edges/3groups,
모델·usage·산출물과 Native 호출 edge inspector의 seq4·5를 확인했다.
이 복구 장면으로 최초 실패를 지우거나 전체 안정성을 인정하지 않는다.

## 남은 원인과 다음 개발 경계

90초 SSE 관측은24개가 연결·대상 Run 유지,2개가 disconnected·대상 숨김이었다.
인가 철회 이벤트는 없었다. 한 실패는 queue0·10초 예산 안에서
`rpc.nativeMetadata`가291ms 만에503을 반환했고 전체 native-window도414ms에
끝났다. 이전의10초 deadline 문제가 이번 실패의 원인이라는 근거는 없다.

직접 서명한 동일 Native의 읽기 전용 후속 진단8회는 모두200이었다. 이는
Projects·Assistant·Track 전체 인가 흐름을 통과한 수용 검사가 아니며, 짧은503의
근본 원인을 확정하지 않는다. 현재 Persona의 metadata port는 여러 하위 오류를
503으로 변환하므로 다음 작업은 이 경계의 원본 HTTP 상태·응답 분류를 비밀값이나
본문 없이 구별하고 공개 Demian 경로·전용 API와 대조하는 것이다.
실패를 숨기기 위해 timeout·권한 범위를 늘리거나 이전 근거를 재노출하지 않는다.
새 인가 확인 후 선택과 상세가 회복되는 동작도 함께 검증한다.

상위 수용은 **15/21·71.4%, 직전 대비0%p**다. AT-14는 미수용이며
AT-06/09/12/14/15/20을 유지한다. 전체 하위 분모와 완료 ETA는 미확정이다.
CI 예외 승인 대기는 해소됐고, 현재 남은 조건은 실제 동시 갱신의 일시503,
원본 앱 인증·명령 실기·peer/다중 장치 검증이다.

[구조화한 배포·검증 근거](projects-read-transport-deployment-verification.json),
[후보와 승인 상태](projects-read-transport-candidate.json),
[전체 수용표](goal-status.md)를 따른다.
