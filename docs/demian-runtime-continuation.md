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

Assistant 소유자 계약 조사에서는 기존 WorkExecution의 Runtime Task/thread/turn을
Demian Run으로 연결하는 durable adapter가 없었다. Projects의 Assistant 실행 링크는
WorkExecution ID이므로 Demian Run ID로 덮어쓰지 않는다.

후속 구현은 Assistant의 owner-scoped intent 저장 → 전용 서명 work-runtime 요청 →
Demian의 원본 Run 할당 receipt 검증 → append-only typed Demian 참조 순서다.
응답 유실은 동일 operation/correlation의 원본 receipt로 조정하며 새 Run 생성으로
대체하지 않는다. Track 읽기 key·Entra proxy·브라우저 cookie는 실행 권한으로
사용하지 않는다. 기존 strict context의 임의 필드나 model input에 제어 정보를 넣지 않는다.

현재 source 구현·proposal은 운영 activation과 다르다. 실행 준비가 갖춰진 뒤
명시된 QA 업무 하나에서 실제 parent/child·peer·교차 앱 관계를 생성·대조하고,
고유 Run 집계·nested group·경계 edge·검증/수용 상태의 구분을 확인한다. 별도
desktop 앱인지 현재 PC 실행 환경인지의 사용자 답변과 두 번째 실제 장치도 남아 있다.
