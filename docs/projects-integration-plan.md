# Projects 원본 조회·실행 연결

AT-07/11/19/20을 진행한다. Projects의 Project/Task·revision·수용 상태를
원본으로 유지하고 Track은 명시한 Run binding 이력과 조회 투영을 소유한다.

## 확인한 현재 계약

- 운영 Projects는 별도 PostgreSQL과 Entra proxy를 사용한다. 소유자 계정
  `pydemia`는 Track 소유자 tenant에 연결되어 있고7개 프로젝트 읽기가 허용된다.
- 기존 signed service API의 Principal은 고유 ID/key·account·project IDs·scope로
  분리된다. `/api/integrations/assistant/v1`이라는 경로 이름과 별개로 principal은
  구성으로 정의된다. Track은 새 principal/key를 발급해 읽기 scope만 갖는다.
- 기존 Assistant credential·principal·프로젝트 범위와 운영 자료를 보존한다.
  Projects의 대규모 미커밋/미추적 개발 파일은 이 작업에서 수정/게시하지 않는다.
- 서비스 토큰은 audience/projects, nonce, 30초 수명, 정확한 HTTP method/path/query/
  body hash, principal ID/revision에 서명한다. 키는 양쪽 private 상태 파일에만 둔다.

## 구현 순서와 수용 조건

1. 읽기 adapter: capabilities에서 쓰기 불가를 확인하고 Project/Task 제목·ID·
   revision·상태만 선별한다. Task 원문·원본 credential·임의 필드는 버린다.
2. 새 전용 principal: 현재 소유자의 native ACL 교집합인 프로젝트 ID에 한정한다.
   기존 설정을 private backup하고 원자적으로 새 entry만 추가한다. 재실행은
   같은 scope/key만 수용하고 모호하거나 달라진 바인딩은 덮어쓰지 않는다.
3. 전용 SSH loopback forward로 기존 서명 검증 ingress에 연결한다. 공개
   Track/Trail Entra 경로와 Projects 브라우저 인증은 바꾸지 않는다.
4. Track 사용자와 native account/principal을 고정한다. metadata 조회·SSE 전에
   원본 프로젝트 권한을 다시 확인하고, bound Run은 해당 Project ID가 현재
   허용될 때만 표시한다. 단절/거부 시 Project 관련 캐시는 fail closed로 숨긴다.
5. 실제 업무 조회와 명시적 Run binding: 최신 Task/project ID·revision을 대조하고
   연결 이력을 남긴다. Run 종료·agent report·검증·Projects 완료/수용을 구별한다.
6. 테스트: HMAC/path/actor/schema·metadata 제외·pagination·다른 Project 거부,
   실제 전용 principal 조회와 scope 철회 후 캐시 비노출, 공개 UI까지 대조한다.

기존 API에는 native Demian Run external-reference나 Track 요약 패널이 없다.
조회 성공을 배정·실행 시작·Projects 문맥 요약 완료로 계산하지 않는다.

## 다음 구현: 명시적 Run 연결

조회 연결은 실제7프로젝트·26업무와 reader 범위 축소/복구까지 확인했다.
다음 변경은 Track 소유의 연결 이력에 한정한다. native Task 상태·본문·revision을
수정하거나 관측한 Run을 임의 업무에 자동 연결하지 않는다.

1. 사용자가 Run 상세에서 허용된 원본 Project/Task와 조회 revision을 선택한다.
   서버는 현재 Run 접근과 원본 Task/project를 새로 읽고 선택 revision이
   달라졌으면409로 돌려준다. 제목은 클라이언트 입력을 신뢰하지 않고 원본에서 읽는다.
2. 요청 UUID와 예상 기존 binding version을 사용한다. SQLite transaction에서
   이력 append·현재 binding·receipt를 함께 반영한다. 같은 UUID 재수신은 같은
   결과를, 내용 충돌이나 다른 탭의 선행 변경은409를 반환한다.
3. 연결/재연결은 해당 Run에만 적용한다. 이전 Run이나 같은 Session의 다른 Run을
   바꾸지 않는다. 연결 당시 Task revision/title은 보존하고 현재 원본 상태와
   구별한다. Run 성공만으로 Task를 완료/수용 처리하지 않는다.
4. 연결 이력 조회도 각 행의 Project 접근을 현재 권한으로 다시 검사한다.
   철회된 과거 Task/project title과 actor 정보가 현재 binding을 통해 새지 않게 한다.
   원본에 접근할 수 없으면 연결을 임의 해제해 Run을 공개하지 않는다.
5. 격리 fixture에서 동시 변경·재시작·재수신·원본 revision 변경·권한 철회를
   검사하고, 실제 QA 전용 업무와 QA Run으로 UI 연결/재연결을 대조한다.
   기존 사용자 업무와 테스트 Run을 근거 없이 연결하지 않는다.

연결 receipt는 Track의 기록 수락이다. 원본 업무의 배정 수락이나 Demian 실행
시작 receipt가 아니며, 그 흐름은 AT-11의 별도 native 계약으로 진행한다.
읽기 연결 후 등록/배정 명령·source acceptance와 소비 앱 요약을 별도 구현한다.

## AT-11: 원본 업무 생성과 실행 배정

원본 코드에서 아래 계약을 확인했다. 실제 운영 원본과의 대조는 별도 실기로
남기며, Track 기능을 켜기 전에 전용 principal의 권한을 확인한다.

- Projects `POST /api/integrations/assistant/v1/projects/{projectId}/tasks`는
  `operation_id/title/body/acceptance_criteria/requires_test`를 받는다.
  `GET .../operations/{operationId}`는 현재 principal/Project ACL로 생성
  receipt를 조회한다. 동일 operation·다른 payload는409다.
- Demian 기존 Session의 `POST /api/v1/sessions/{sessionId}/runs`는
  `Idempotency-Key`를 받으며202 접수·200 재수신을 구분한다.
  `GET .../requests/{requestId}`로 found/not_found와 Run을 확인한다.
  Session 생성에는 동등한 idempotency 계약이 없다. 배정 첫 단계는 사용자가
  명시적으로 선택한 기존 허용 Session을 대상으로 한다. 새 Session 생성의
  응답 유실을 제목 검색으로 성공 처리하지 않는다.

구현 순서와 실패 정책은 다음과 같다.

1. 기존 reader는 그대로 두고 별도 task-creator principal/key와 명시 Project
   범위를 사용한다. 필요한 scope는 projects:read/tasks:read/tasks:create다.
   업무 수정·결과 첨부·완료 권한은 이 생성 기능에 포함하지 않는다. Track의
   현재 소유자 opt-in, reader Project grant와 writer native ACL의 교집합을
   매 전송·접수 조회에서 확인한다.
2. 생성 초안은 UI에 유지하고, Track 원장에는 actor·operation ID·source
   identity·정확한 요청 해시·Project ID·생성된 Task ID/revision만 남긴다.
   전송 전 transaction으로 접수를 기록하며 같은 UUID는 재전송하지 않는다.
   같은 Project에 미확정 생성이 있으면 새 UUID도 막는다. 통신 오류를 실패나
   업무 없음으로 해석하지 않고 원본 operation 조회로 확인한다.
3. 원본 receipt의 operation/method/path/body hash/Project/kind/revision을
   대조한다. 본문·criteria가 포함된 응답은 일시적으로 파싱하되 원장·브라우저
   응답에 저장하지 않는다. 성공은 Projects의 업무 생성 접수이며 Demian
   실행 접수·실행 종료·업무 수용과 구별한다.
4. 기존 Task 배정은 최신 Project/Task revision과 선택 Session의 현재
   권한을 읽고 명시한 입력만 전달한다. 원본 Run 접수를 확인한 뒤 해당 Run에
   연결 당시 Task revision으로 binding을 남긴다. Projects 업무 상태를 자동으로
   완료하거나 기존 binding을 덮어쓰지 않는다.
5. 배정 원장에도 요청 ID·입력 해시와 원본 Run ID만 저장한다. 응답 유실 시
   request-status를 읽고 새 실행을 자동 생성하지 않는다. 접수 확인 후 binding
   실패는 별도로 표시해, 이미 시작된 실행을 다시 만들지 않고 연결을 복구한다.
6. fixture의 동시 UUID·원본409·권한 철회·기한·응답 유실·재시작을 확인한 후
   QA 전용 원본 업무와 기존 QA Session으로 공개 UI 생성/배정을 대조한다.
   실패 시 초안 유지·확정/미확정 구분,390px·키보드·로그아웃 후 초안 제거도
   확인한다. 실제 원본 접수와 공개 UI 전까지 AT-11을 완료로 계산하지 않는다.

현재 생성 adapter·metadata-only 처리 원장·BFF/UI·시작 시 복구를 연결했다.
전용 task-creator principal은 기존 reader의 허용 범위 안에서 QA 프로젝트
1개만 명시했고, reader와 Assistant 설정은 보존했다. 그 외 읽기 가능한
프로젝트는 생성 불가로 표시한다. 다른 사용자의 native principal 위임은
이 소유자 배포의 범위에 포함되지 않는다.

공개 Entra UI에서 실제 QA 업무1건을 생성했다. 원본 operation/Task ID·revision1·
정확한 요청 해시·본문·수용 기준·todo 상태가 일치했다. 생성 후 초안이 비워졌고
Track 원장에는 본문·제목·수용 기준이 없었다. 네이티브 실행 배정은0건이다.
390px·Tab, 입력 크기 거부 시 초안 유지, reader scope7→6에서 API404·POST403/
원장 변화 없음·공개 초안 제거→7복구와 빈 초안도 확인했다.

다음은 기존 Task/Session 선택·내용 명시 검토, Demian Run request-status와
접수 후 binding의 복구를 구현하고 실제 배정을 대조하는 단계다.
Task 생성 성공만으로 AT-11을 완료로 계산하지 않는다.
