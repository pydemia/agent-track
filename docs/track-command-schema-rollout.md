# 명령 원장의 운영 전환 검사

동결 API·웹 후보는 `88b2557a41e1a41144293be76e7f425940134b75`다. 운영
전환기는 앱과 별도로 현재 source hash를 고정한다. 앱 변경 없이 후보를 다시
만들지 않고, 새 원장 스키마의 보존·복귀 검사를 전환기에 추가했다.

## 승인 범위

새 SQLite 객체는 `successor_intents`, `coordinator_command_intents`와 각각의
기본 키 autoindex·unresolved unique index까지 총 6개다. 이름만 비교하지 않고
type·table·정확한 SQL을 대조한다. 자동 인덱스의 SQL null도 그대로 확인한다.
새 column·약화된 index·누락 index·trigger·다른 table·기존 이력 삭제는 거부한다.

기본 보존 검사는 여전히 새 객체를 허용하지 않는다. version 2의 hash 고정된
cold QA에서 `commandSchemaVersion: 1`, 정확한 객체 목록과 두 release의 검사
근거가 있을 때만 명령 원장 추가를 허용한다. 이전 버전에도 새 스키마가 유지되고,
검사 종료 시 새 테이블이 비어 있다는 증거가 필요하다. 기존 saved-flow migration
검사와 기존 table의 typed row·cursor·binding·source 보존 검사도 유지한다.

## 실제 격리 검사

2026-11-14 operation `865676f4-54de-4fb0-a7b5-6dd52b8678ac`에서 현재 Track
DB 25,759,744 bytes의 새 SQLite 백업을 확인했다. 기존 12개 table과 원본 Native
45개 table, 보호 파일 52개·프로세스 20개를 기준으로 고정했다.

후보는 백업 사본에서 새 6개 객체를 생성했고 기존 table·schema·행을 보존했다.
이전 버전은 후보 DB의 WAL까지 포함한 SQLite 백업 사본에서 기동했다. 이 사본에만
넣은 합성 unknown row가 그대로 유지되는 것을 확인한 뒤 정확한 자기 row만 제거했다.
실제 원본 DB에 이 합성 row를 넣거나 과거 DB를 복원하지 않았다. 두 앱의 root와
18개 웹 자산의 MIME·SHA, 빈 source snapshot과 저장 보기 조회도 확인했다.

첫 격리 시도는 WAL을 포함하지 않은 일반 파일 복사 때문에 복귀용 사본에 새
table이 없어서 실패했다. 실패 산출물을 보존하고 격리 사본 간 복사에도 기존의
SQLite 백업 API를 적용했다. 운영 원본의 백업을 반복하지 않았다.

기준 상태를 처음 읽을 때 Track reverse-forward PID 파일이 종료된 중복 시도를
가리켜 검사가 중단됐다. 기존의 정확한 SSH command·실행 파일·생성 시각·동일
Windows 사용자를 확인한 후 startup mutex 안에서 PID 파일만 CAS 수정했다.
기존 SSH 프로세스, 연결, credential은 재시작하거나 바꾸지 않았다.

전환기 관련 43개 검사·타입 검사를 통과했고 독립 source 검토에는 추가 지적이
없었다. 실제 운영 전환·현재 권한의 전체 업무·Entra 사용자 화면은 별도 확인한다.

## 실행 중인 원본 Native의 보존 검사

운영 전환 전의 읽기 전용 검사가 원본 Native의 전체 data hash 변경을 거부했다.
변경된 것은 세 worker registry의 `checked_at`과 서명 조회마다 추가되는
`work_runtime_delegation_nonces`였다. 나머지 41개 table, schema·sequence·security는
일치했고, 최초 nonce 4,477개의 canonical row hash도 그대로 일치했다.

기본 검사는 전체 값의 일치를 계속 요구한다. 명시적으로 고정한 원본 snapshot에
`delegationNonces` 증거가 있을 때만 nonce 추가를 허용한다. 기존 nonce는 identity와
모든 값·삽입 transaction을 보존한다. 만료된 행도 삭제를 허용하지 않는다. 새 행은
이전 PostgreSQL MVCC snapshot에서는 보이지 않던 transaction에서 삽입됐고 현재
snapshot에서는 보이는지 확인한다. 두 snapshot 사이에 진행 중인 transaction이
늦게 commit될 수 있으므로 수집 시각만으로 추가 여부를 판정하지 않는다.

각 nonce의 수락 시각은 관측 시각 이하여야 하며 유효기간은 수락 후 60초 이내,
보존 기한은 만료 후 정확히 120초다. 원본 migration 011과 서명 검증·삽입 코드의
계약을 기준으로 했다. raw nonce·credential은 추출하지 않고 identity/행 hash,
시각·transaction snapshot만 비교한다. 전체 row 수는 100,000개로 제한한다.

이 정책은 원본 runtime·DB·권한을 변경하지 않는다. 기존 snapshot을 보존하고,
아직 운영 변경 단계에 들어가지 않은 전환 계획의 보존 기준만 새 읽기 전용
snapshot으로 고정한다. 기존 Track 백업과 두 release의 cold QA도 재사용한다.

MVCC 판정은 [PostgreSQL snapshot 문서](https://www.postgresql.org/docs/current/functions-info.html#FUNCTIONS-PG-SNAPSHOT)에 따른다.
현재 nonce writer는 직접 transaction에서 삽입한다. subtransaction ID는 일반
snapshot visibility 계산과 의미가 다르므로 새 writer가 savepoint 내부 삽입을
도입하면 이 정책을 재검토해야 한다. 특수 bootstrap/frozen XID는 epoch를 붙이지
않으며, 32-bit wrap 전후의 일반 XID·특수 XID 수집 회귀 검사를 포함한다.
