# 일반 Native 실행의 후속 명령

현재는 source 구현·격리 HTTP/SQLite 검증 단계다. 운영 설정의 권한, Entra,
Native·Assistant·Track 프로세스와 기존 AgentTrail을 변경하지 않았다.

실패 재시도는 원래 입력의 새 Run과 `retry_of` 관계를, 중단 작업 재개는 같은
입력의 새 Run과 `continues` 관계를 요청한다. 계속 실행은 사용자가 확인한 새 입력과
새 작업 root를 만든다. 명령 접수, 새 Run 관측, 실행 성공과 Projects 수용은 별개다.

## 검토·전송·복구

일반 Native 출처의 명령은 proxy 인증의 단일 owner와 별도 `runCommandUsers` 설정,
현재 Native 명령 context가 모두 허용할 때 열린다. 취소 권한을 이 권한으로 바꾸지
않는다. 보호된 Assistant source는 이 경로로 실행할 수 없고 reader는 계속 읽기 전용이다.
설정이 없는 출처, 로그 source와 이전 Native API에는 해당 한계를 표시한다.

화면은 원본 상태를 다시 읽고 검토를 저장한 다음, 사용자가 명시적으로 확인한
경우에만 전송한다. 검토 ID는 Native command ID로도 사용한다. 같은 ID의 다른 내용은
충돌이며, 미확정 요청이 있으면 다른 ID로 새 실행을 만들 수 없다. 날짜 offset과 UUID
대소문자는 canonical 표현으로 정규화한다. 검토 기한은 최대120초다.

| 상태 | 의미 | 다음 동작 |
| --- | --- | --- |
| prepared | 검토 저장, Native 미전송 | 확인 후 전송 또는 검토 폐기 |
| dispatching | 한 호출이 전송 권리를 확보 | 같은 ID 조회 |
| unknown | 전송 결과를 확정하지 못함 | 같은 ID의 Native receipt만 조회 |
| accepted | 원본이 새 Run을 접수 | 관측 pending/observed와 실행 상태 별도 확인 |
| rejected / expired | 원본 거절 또는 전송 전 차단·기한 경과 | 사유와 현재 상태를 다시 검토 |

SQLite의 `successor_intents`는 actor·ID의 내용 digest와 비공개 context·명령 descriptor를
보존한다. actor·Run별 미해결 요청은 하나만 허용하고 CAS로 전송 호출을 한 번만
선택한다. 접수 receipt를 먼저 저장한 뒤 새 Run의 Native·Session·이벤트 조회 권한을
대조한다. 접수 후 관측에 실패해도 accepted를 실패나 실행 완료로 바꾸지 않는다.
전송 claim에서 staging의 `input_json` 필드를 비우며 SQLite/WAL·백업 전체의
과거 바이트를 삭제하는 작업은 수행하지 않는다.

응답 유실이나 재시작의 복구는 같은 ID의 GET뿐이다. `not_found`도 이미 진행한
전송이 미접수됐다는 확정 근거로 사용하지 않는다. 전송 후에는 기한이 지나도
미확정 상태를 단순 expired로 바꾸지 않고 새 ID의 자동 재전송을 막는다.

현재 actor·Origin·출처·Native/Projects 접근, 원본 Run·Session·binding·cursor와
검토한 head·authority·업무 revision을 다시 대조한다. credential 파일의 비동기 읽기
뒤에는 동기 검사와 실제 fetch 사이에 await를 두지 않는다. 이 경합은 실제 로컬
credential I/O 중 권한을 철회하는 회귀 검사에서 수정 전 실패·수정 후 전송0을 확인했다.
전송 전 차단임을 transport가 입증한 경우만 명시한 rejected/expired로 기록하고,
fetch를 호출한 뒤의 불확실한 오류와 구분한다.

재시도·재개의 새 Run은 검토한 Task 연결과 당시 revision을 유지한다. 계속 실행의
새 작업 root는 기존 Projects Task에 자동 배정하지 않는다. 기존 Run과 이벤트는
보존한다. 새 Run은 현재 권한 확인 후 Track metadata에 등록하고 기존 수집기가
다음 주기부터 실제 이벤트를 읽는다. 이 등록을 tool/step 관측으로 계산하지 않는다.

## 화면과 API

`GET /api/runs/:runKey/successor-commands`는 현재 가능한 명령과 최근100개 receipt의
조회 창·추가 이력 여부를 반환한다. `GET`의 `/:id`는 같은 요청을 복구한다.
`POST /reviews`는 검토만 저장하고 `POST /:id/dispatch`가 확인한 요청을 전송한다.
`POST /:id/discard`는 아직 전송하지 않은 검토만 폐기한다. 외부 Origin·다른 actor·
경로와 body의 다른 Run·중복/추가 query와 예상 밖 body는 허용하지 않는다.

브라우저에는 authority/head hash, credential·private context·원본 입력을 receipt로
보내지 않는다. 계속 실행의 새 입력은 해당 검토 화면에서 정확히 확인하고, 다시 연
화면에 입력 초안이 없으면 그 검토를 전송할 수 없다. 폐기한 뒤 새로 작성해야 한다.
비밀 입력을 브라우저 저장소나 URL에 보존하지 않는다. 권한/범위 조회가 실패하면
이전 기록과 입력을 지우고 새 요청을 잠근다. 자동 POST 재전송은 없다.

실제 HTML·인증된 현재 PC에서 버튼과 키보드·모바일 동작을 확인한 결과는 아직 없다.
소스의 browser client 계약 검사를 실제 사용자 화면 검증으로 바꾸지 않는다.
[최종 파일별 검증과 한계](run-successor-controls-verification.json)를 따른다.

최종 전체 회귀는1,093개 중1,083개 통과·실패0·skip10이다. skip은 기존 Windows의
POSIX 전용9개와 선택 Persona source 환경1개다. 관련39개, 실패가 있었던 HTTP 경로
66개, 타입과 별도 web build도 통과했다. 실제 로컬 HTTP·파일 I/O와 SQLite를 사용했으나
Native upstream 데이터는 합성값이며 실제 모델·운영 DB를 사용한 검사는 아니다.

첫 전체 검사의 실패4개는 보존했다. 하나는 명시한 fetch `bad port`였고 현재 Windows
동적 TCP 범위1024~15000이 Fetch 차단 포트와 겹쳤다. 나머지 세 실패의 당시 포트는
기록되지 않아 동일 원인으로 확정하지 않는다. 영향받은 fixture는 URL을 공개하기 전에
차단 포트가 아닌 OS 할당을 선택하도록 고쳤다. 제품 요청이나 실패 assertion을
재시도·완화하거나 OS 설정을 바꾸지 않았다. [포트 정책 원문](https://fetch.spec.whatwg.org/#port-blocking)을 따른다.

## 남은 범위

보호된 Assistant 실행의 owner 제어 API를 Track에 연결하는 계약·별도 권한은
아직 구현하지 않았다. 단순히 같은 Entra 이메일이거나 reader token이 있다는 이유로
owner를 대행하지 않는다. 일반 Native의 receipt 관계를 Flow의 전후 Run edge로
표현하는 [후속 source](native-command-flow.md)는 현재 권한을 대조하는 snapshot metadata와
별도 실선 edge로 연결했다. 기존 Assistant의 coordinator-intent 관계와 구분한다.

운영 반영에는 새 Track private table·입력 보존/삭제와 복구 상태의 release/rollback
검증이 필요하다. 기존17e5ff0/9f45e6c/f9f78ac 후보를 이번 source로 간주하지 않는다.
실제 Native·Assistant 원본의 CI·배포 gate와 실제 제공자 실행 검증, 현재 PC의
인증된 UI 수용도 남아 있다. 전체 수용15/21·71.4%(상위 동일 가중치·부분0),
전체 ETA 산정 불가·신뢰도 낮음을 유지한다.
