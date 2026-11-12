# Demian 실행 연결 후속 순서

기준: 2026-11-12 KST. Track의 산출물 그룹 연결은 기존 native metadata를
읽어 검증했다. 현재 API-only 관측과 worker 실행 준비를 구분한다. 전체 수용
조건은 14/21(66.7%, 동일 가중치), 완료 예상 산정 불가·신뢰도 낮음이다.

## 확인한 상태와 출처

원본 API는 고정된 bundle로 운영 중이고 worker·optional work-runtime·peer
registry는 활성화하지 않았다. 원본 19 Run·810 event와 기존 Assistant 37 event를
Track에서 재확인했다. 새 Task·Run·모델 호출을 만들지 않았다.

Demian 소유 대화 `01a1c901-2cea-7a21-9b38-8d12445f0a49`의
`01a1cef0-8526-7613-8186-52ec435e59a3` 턴은 worker·자동 시작을 읽기 전용으로
조사했다. 다음은 그 소유자 조사 결과이며 Track에서 worker를 기동해 검증한
결과가 아니다. 소유자가 마지막으로 대조한 DB 시각은 2026-11-12 17:31:24 KST다.

## 실행 준비

1. API-only 자동 시작은 `bbcfe95`에서 구현하고 현재 사용자 로그온 작업을 등록했다.
   실제 task 결과0·기존 PID15940 재사용과 전체 native DB/보안 catalog·설정 8개·
   process 보존을 확인했다. 실행 계정·격리 home·설정·frozen entry/hash와 현재
   listener의 PID·exe·entry·creation time을 대조한다. 다른 listener는 보존한다.
   실제 native cold start·PC 재부팅과 구분한다. `demian-api-startup.md` 참고.
2. Worker는 기동 즉시 상태 발행·만료 복구·작업 임대를 시작한다. queued=0은
   새 작업 유입 차단이 아니다. 현재 stop은 진행 중인 polling·임대와 별도 상태
   발행을 모두 기다리지 않으므로 작업 수신 제어와 종료 경합을 먼저 해소한다.
3. Worker와 runtime core를 함께 고정한다. 설치 worker와 현재 source build는
   DB 관계 모듈 구간이 달랐고 core는 일치했다는 소유자 보고가 있다. mutable
   checkout의 runtime module을 frozen worker와 혼용하지 않는다. 외부 import·
   resource 경로와 초기화 부작용은 추가 검증 대상이다.
4. 원래 worker-home·runtime-home·provider별 OAuth 위치를 보존한다. Legacy
   provider의 상태 검사는 OAuth 갱신·저장을 할 수 있어 최종 합성 설정까지 확인한다.
   실행 파일 존재나 capability catalog만으로 인증·managed-child 준비를 완료 처리하지 않는다.
5. Worker를 기동할 때는 해당 worker의 status/capability/catalog 갱신과 실제 작업
   임대에 따른 쓰기를 구분한다. 기존 종료 Run·event·message·artifact·역할·멤버십·
   credential을 초기화하거나 source 재수집을 새 실행으로 계산하지 않는다.

## 교차 앱 연결

배포된 Assistant reader `5196c8bc`의 최초 조사에는 Demian dispatch adapter가
없었다. 이후 통합 Root의 별도 작업 조사에서 기존 durable gateway와 최신 검증
기록을 확인했다. 별도 gateway의 미커밋 source까지 포함해 `5196c8bc` 기반의
격리 branch에 통합하고 있다. adapter나 receipt 원장을 새로 중복 구현하지 않는다.
Projects의 Assistant 실행 링크는 WorkExecution ID이므로 Demian Run ID로
덮어쓰지 않는다.

기존 gateway의 owner-scoped intent·서명 요청·POST-once·native receipt와
GET-only 유실 응답 조정을 재사용한다. strict 관측 및 v2 producer 참조 계약은
`assistant-demian-observer.md`를 따른다. 현재 운영 source는 v1이며 v2 소비자의
정확한 native source mapping·현재 Assistant/Projects/Demian 권한 교집합과
operation receipt 대조는 Track에 구현했다. Root 소유 native 전환과 실제
producer/credential 설정은 남았다. 전환은 Work/runtime DDL을 추가하므로 이전
schemaUnchanged guard 대신 최신 데이터 보존·backup/rollback 계약을 새로
정의해야 한다. Track 읽기 key·Entra proxy·브라우저 cookie는
실행 권한으로 사용하지 않는다. 기존 model input에 제어 정보를 넣지 않는다.

현재 source 구현·proposal은 운영 activation과 다르다. 실행 준비가 갖춰진 뒤
명시된 QA 업무 하나에서 실제 parent/child·peer·교차 앱 관계를 생성·대조하고,
고유 Run 집계·nested group·경계 edge·검증/수용 상태의 구분을 확인한다. 별도
desktop 앱인지 현재 PC 실행 환경인지의 사용자 답변과 두 번째 실제 장치도 남아 있다.

## 2026-11-13 읽기 전용 재확인과 다음 경계

Native PR22는 `b449f5fe`의 open/draft 상태다. API-only PID15940과 원본
19Run/810event·45테이블은 유지했고 worker/runtime/credential을 변경하지 않았다.
Track는 그룹 요약·탐색 복원 구현을 게시했으며 실행 준비를 대신하지 않는다.

현재 worker source의 `start()`는 provider 로그인 worker와 상태 발행·만료 복구를
거쳐 lease를 시작한다. `stop()`은 active execution과 로그인 worker를 기다리지만
전체 polling·lease·별도 status publish를 모두 기다리는 계약은 확인하지 못했다.
worker/config/runtime-bridge의 기존 미커밋 변경은 보존했고 읽기만 했다.

소유자 대화의 후속 조사에서 기존 freeze/drain/정확한 QA scope lease 계약은
없다고 확인했다. 기존 source manifest689개와 metadata 후속8개를 경로로 합친
현재692개는 전부 SHA가 일치했다. 이 소스와 worker/core 산출물2개를 보존하고
격리 branch의 `5943eec`에 source snapshot을 기록했다. 원본 WIP는 수정하지 않았다.

그 위에 DB·인증/provider 쓰기를 하지 않는 `frozen-readiness` 진입점을 구현했다.
별도 설치한 dependency와 소스·worker/core를 manifest 하나로 묶고 외부 pin으로
전체 tree의 누락·추가·변조·외부 link·만료를 검사한다. 현재 실행 파일도 해당
payload에 속해야 한다. 모드 누락·빈 값·미지원·아직 구현 전인 `qa`는 일반 실행으로
넘어가지 않고 거부한다. 이 branch의 일반 실행은 명시적인 `general`에서만 가능하다.
원본 worker service 설정은 변경하지 않았다.

후속 격리 구현 `1c691aa`는 정확한 org→workspace→session→run tuple의 만료 있는
QA scope를 candidate lease와 만료 복구·workspace lease 삭제에 함께 적용한다.
진행 중 prepare/claim·미dispatch claim·실행/event/heartbeat/status/login을 모두
기다리는 drain과 명시적 cancel 전환도 구현했다. 늦은 claim의 정리 실패를 성공으로
숨기지 않는다. child/peer/delegated의 QA 등록은 여전히 기존 admission transaction에서
권한·Run·receipt와 원자적으로 처리해야 한다. ancestry/tag에서 권한을 상속하지 않는다.
QA intake 제한과 전역 admission freeze는 다른 기능이다.

준비 검사는 실제 worker 활성화·provider 인증·Task/Run 생성이 아니다. 실제 기동·
credential·DDL 변경은 최신 보존/복구와 현재 원본 권한을 검증한 뒤 수행한다.
native Work/runtime DDL 전환에는 기존 schemaUnchanged guard를 재사용하지 않는다.

격리 구현은 `d493ae8`의 로컬 commit이며 아직 원격 게시·운영 적용하지 않았다.
준비 검사69개·compiled CLI8개와 worker typecheck·core/worker build를 통과했다.
실제 dependency18,886개 파일을 포함한19,589파일/5link payload의 compiled
진입점에서도 추가 runtime import·network·subprocess·payload 밖 파일 조회 시도는
모두0이고 dispatch는 false였다. 원본692입력/산출물2개, DB 전체 행·DDL·sequence·
보안 catalog, 보호 파일8개와 API/Web/gate/container를 보존했다.
검사 범위·pin·잔여 조건은 `demian-worker-readiness-verification.json`에 기록한다.

범위 제한·종료 후속은 별도 label-owned tmpfs PostgreSQL과 fake provider/CLI에서
관련154개 전부 통과·skip0, worker/db typecheck와 worker build를 확인했다.
기존 취소·완료 fence도 함께 검사했다. 실제 OS 신호의 교차 플랫폼 검증은 아니며,
검사에는 운영 DB·provider credential을 사용하지 않았다. 운영 DB는 별도의 읽기 전용
보존 대조만 수행했다. QA 컨테이너·임시 credential은
정리했고 원본692입력/산출물2개·전체 native DB/보안 catalog·보호 파일8개·서비스를
보존했다. `demian-worker-intake-verification.json`에 범위와 초기 fixture 오류도 기록했다.

이 변경도 로컬 commit이며 운영 worker·QA CLI를 활성화하지 않았다. 다음은 현재
권한에 따른 atomic QA 등록과 pinned runtime/설정 전달이다. 이전 d493ae8의 frozen
payload를 새 worker의 준비 증거로 재사용하지 않고 활성화 직전 새 closure를 만든다.
