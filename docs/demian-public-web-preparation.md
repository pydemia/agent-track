# Demian 공개 웹·Entra 전환 준비

기준: 2026-11-13 KST. AT-06·AT-20의 원본 웹 접근과 문맥 요약을 위한 준비다.
설정 검사와 공개 서비스 활성화를 구별한다. 현재 `demian.pydemia.ai`는 여전히
Basic 인증401이며 Entra 전환·원본 웹 교체를 완료하지 않았다.

## 현재 경계

원본 공개 웹3001·Basic gate3100·API8080은 살아 있다. 이번 조회에서 실제
listener 소유자는 각각48516·36448·15940이었다. 기존 domain tunnel14616의
process identity도 전후 대조했다. 원본 worker는 이번 작업으로 시작하지 않았다.
3000은 다른 앱의 포트이므로 전환·준비·복구 대상에서 제외한다.

이전 `deploy/demian/promote-web.mjs`는 local3000과 public3001을 함께 교체하고
과거 API/worker metadata와 전역 활성화에 의존한다. 원본 API-only startup이
고정한 `service.json`도 변경하므로 **현재 운영에 그대로 실행하지 않는다.**
현재 원본 소스는 다른 개발 작업 중이며 그 checkout에서 새 build를 만들지 않는다.

## 구현한 격리 경계

- `loadWebRelease(state, "public")`는 `track-context/active-public.json`만 읽으며
  `profile: "public"`을 요구한다. 기존 `active.json`으로 우회 복원하지 않는다.
  public 전용 활성화 파일은 기존 local/legacy loader가 읽지 않는다.
- `patchStartup(text, "public", { publicOnly: true })`는 public 전용 loader를
  선택하고 설정 포트가3001이 아니면 실행 전에 거부한다. 실제 원본 startup에
  패치를 생성해 gate/tunnel launch 행 보존을 확인했다. 생성 결과는 운영 파일에
  쓰지 않았으며 combined launcher도 실행하지 않았다.
- `run-web.mjs`는 public3001·local3000·qa3002를 구분한다. public 설정을3000이나
  3002로 바꿔 다른 listener를 차지하지 못한다. local 프로필은 별도 기존 기능이며
  이번 public-only 전환에서 호출하지 않는다.
- 복구 helper의 public 전용 경로는 명시적인 원본/교체 process와 독립 frozen
  fallback을 사용해야 한다. stop intent를 먼저 기록하고 출력 유실은 동일 process의
  실제 상태로 해소한다. 외부 listener·PID 재사용을 소유 실행으로 처리하지 않는다.

동결 candidate `CDH-N8gACrby4eI25LO5q`의 manifest SHA-256은
`72c1e3b2c3a988a6eb0777ea70cde9c5ef85ad42325069d25caf67c7330d7a3e`다.
실제1538개 파일을 현재 manifest와 다시 대조했다. 별도로 현재 서비스와 같은
`gULRpDkjzmL9RnPCwAF-4` standalone·static·public을 독립 rollback release로
동결했다.1527파일의 manifest SHA-256은
`ab956881454f210d64cfe44bd0d6c5e3850f4fafb8d8188eb74d7008b3724b6b`다.
세 원본 디렉터리의 전후 파일 집합과 각 hash, 알려진 private 값4개의 비포함을
확인했다. 이후 rollback을3002에서 실제 기동해 홈200·정적 JS byte/hash 일치와
원본45테이블 전체 행/스키마·sequence·보안 catalog·보호파일10개·서비스4개의
전후 동일함을 확인했다. 소유한 QA child는 종료했고3002가 비었음을 확인했다.

### 현재 runtime 검증과 실행 기록

새 `windows-web-process.mjs`는 PID·실행 파일·명령·생성 시각을 모두 대조하고
정확한 loopback listener 소유권을 확인한다. 종료할 때 native handle을 먼저
확보한 뒤 다시 검사하며, 그 handle을
[Win32 TerminateProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess)에
직접 전달한다. 다른 listener나 재사용된 identity는 거부한다. 포트 관측과 종료를
하나의 원자적 행위라고 주장하지 않으며 외부 process를 종료하지 않는 경계를 검증한다.

`run-web.mjs --operation-id <UUID>`는 명령에 작업 참조를 포함하고 작업별
starting/ready 기록을 각각 exclusive 생성한다. 기존 legacy 기록은 덮어쓰지 않는다.
ready 기록에는 실제 CIM identity가 들어가며 실행 파일·entry·작업 ID·listener와
retained child가 맞을 때만 실행을 인수한다. 결과 유실을 재실행으로 해결하지 않고
해당 작업의 기록과 실제 identity로 해소할 수 있게 하는 경계다.

| 실제 QA | 결과 | 검증 범위 |
| --- | --- | --- |
| 원본 rollback 기동 | 홈200·정적 파일 bytes/hash 일치 | 동결 원본 build의 실제 서버 기동·종료, 원본 전체 DB/서비스 보존 |
| 새 작업별 launcher로 rollback 기동 | 홈200·ready identity 일치·중복 작업 거부·handle 종료 | 작업별 exclusive 기록과 기존 기록 불변,45테이블·설정11개·서비스4개 보존 |
| 동일 launcher로 candidate 기동 | 홈200·현재 원본 Session3Run/1Session 요약·Track 링크 정상 | 현재 native API와 owner 전후 재인가·기존 명시2Session scope. 헤더 누락/다른 Origin/actor403 |
| Windows 복구 제어기와 실제 adapter | 기존 실행 종료→동일 포트 successor→종료 응답 유실→fallback 복구 | 외부/위조 identity 거부, journal 후 종료, 활성화 충돌과 복구 독립. 원본 native 포트가 아닌 fixture에서 검사 |

두 launcher QA는3002에서 수행하고 종료·포트 해제·동결 release 불변을 확인했다.
candidate의 BFF 검증은 loopback 소유자/명시 Session 범위이며 Entra 사용자 로그인이나
공개 웹 운영 적용을 뜻하지 않는다. 현재 원본19Run·810event를 유지했다.

### 현재 원본 DB의 암호화 backup

API를 중단하지 않고 새 AES-256-GCM/DPAPI backup을 생성했다. 인증 readback·변조
거부 후 원본과 같은 image의 별도 network-none·read-only root·tmpfs 데이터
컨테이너에 실제 복원했다. 원본 volume을 붙이지 않았으며 전체45테이블·role과
password hash·sequence·DDL 의미를 대조하고 검사 컨테이너를 소유권 확인 후 정리했다.
원본에 restore·downgrade·restart를 수행하지 않았다. CHECK 정의 표현의 차이는
이전 검증과 같은 canonical 비교를 사용했고 다른 DDL bytes는 유지한다. raw schema
dump 전체가 동일하다고 표시하지 않는다.

기존 canary용 backup helper는 전체 DB client0을 요구해 현재 API idle pool과 맞지
않았다. 원본 helper/증거는 보존하고 별도 온라인 검증에서 idle client를 허용하되
활성 peer가 있으면 실패하도록 했다. dump의 exported repeatable-read snapshot,
완료 후 새 snapshot의 전체 행·DDL·role·sequence 비교와 원본 보존 조건은 유지했다.
활동 정보의 transaction cache는 검사 직전 `pg_stat_clear_snapshot()`으로 비운다.
[PostgreSQL17 통계 snapshot 문서](https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-STATS-VIEWS)의
동작을 실제 READ ONLY 연결 두 개로 재현하고 데이터 snapshot 불변을 확인했다.
이 점검은 파일·디스크 전체 backup이나 off-machine key 복구 증거로 확대하지 않는다.

## Demian 전용 SSO 설정

| 구간 | 설정 | 현재 상태 |
| --- | --- | --- |
| 공개 진입 | `demian.pydemia.ai` → Demian 전용 OAuth2 Proxy | 기존 Basic 경로 유지. Cloudflare 변경 전 |
| Entra | pydemia 단일 tenant, 별도 Demian client, callback `/oauth2/callback` | 관리자 로그인·기존 등록 확인 대기 |
| 로그인 권한 | `openid profile email`, 현재 소유자 이메일 allowlist | renderer 구현. 추가 Graph 권한 없음 |
| Linux 인증 | loopback14430 → Caddy14431 | 설정 검사만 수행. 유닛 미등록·미시작 |
| 내부 upstream | Caddy → reverse SSH14432 → Windows loopback3100 | 계획한 경로. transport 미시작 |
| 내부 Basic | private `bridge.env`에서 gate 전용 헤더 주입 | 실제 credential 파일 미작성. 브라우저 Basic·OAuth token을 gate credential로 사용하지 않음 |

`deploy/sso/demian-profile.mjs`는 파일 내용을 생성·검사만 한다. Trail/Track의
client ID 재사용을 거부하고 Demian의 cookie·client 환경 파일·유닛 이름을 분리한다.
인증 cookie는 secure·HttpOnly·SameSite=Lax의 `__Host-demian`, nonce 확인과
PKCE S256을 사용한다. Caddy는 upstream Authorization을 전용 private 값으로
교체하고 access-token forwarding 헤더를 제거한다. Linux-local process를
신뢰하는 기존 loopback 호스트 경계를 전제로 하며 격리된 다중 사용자 호스트의
추가 권한 분리를 검증한 결과는 아니다.

설정 항목은 설치 버전과 맞는
[OAuth2 Proxy Entra 문서](https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/ms_entra_id/)와
[Caddy upstream 헤더 문서](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers)를 참고했다.

## 실제 검사와 남은 실행

서버의 OAuth2 Proxy7.15.2 `--config-test`, Caddy2.11.7 `validate`,
`systemd-analyze --user verify`를 새 격리 디렉터리·합성 자격 증명으로 실행해
모두 exit0을 확인했다. 실제 Entra client/secret이나 Basic credential은 사용하지
않았다. 해당 디렉터리는 정리했고 기존 Trail/Track 파일·유닛9개의 hash/mode와
서비스3개의 active 상태를 전후 대조했다. Caddy 서식 안내와 기존 시스템의
무관한 spice-vdagent 유닛 경고가 있었으며 새 Demian 유닛 오류는 없었다.

다음 조건을 충족한 뒤 실제 전환을 수행한다.

1. 관리자 로그인 후 기존 Demian 등록을 확인한다. 신규 등록이 필요하면 별도
   client·단일 tenant·정확한 callback·추가 Graph 권한 없는 등록 내용을 검토한다.
2. 실제 private 환경 파일과 별도 cookie를 제한 권한으로 준비하고 원본/현재
   SSO 설정 hash·포트·프로세스를 다시 확인한다. 실제 secret을 기획·로그에 남기지 않는다.
3. 공개 웹 전용 operator에 현재 process의 정확한 실행 파일·명령·생성 identity,
   현재 DB/설정 보존 기준과 위에서 검증한 backup·rollback의 현재 일치를 다시
   확인하고 실제 전환 adapter에 연결한다.
   `service.json`·local startup·API·worker·gate·tunnel은 변경하지 않는다.
4. journal·조건부 metadata 쓰기·종료/시작 출력 유실 복구를 실제 adapter와 연결하고
   preflight 통과 후 공개 웹만 전환한다. 지금의 helper/fixture만으로 실행 준비를
   완료 판정하지 않는다.
5. private SSO/transport 상태를 확인한 뒤 공개 경로를 전환한다. 정상 소유자 로그인,
   비소유자/다른 tenant 거부, 익명 API401, 공개 Basic 우회 차단, Session deep link,
   문맥 요약·장애 격리·Trail 보존을 실제 경로에서 검증한다.

검증 기록은 `demian-public-web-preparation-verification.json`에 연결한다. AT-06·20은
부분 상태, 전체는 동일 가중치14/21개(66.7%)로 유지한다. 관리자 로그인·원본 웹 운영
반영·교차 앱/장치 실기가 남아 전체 완료 예상은 산정 불가, 신뢰도 낮음이다.

## 공개 웹 전용 실행 operator

2026-11-13 실제 운영 반영: 최종 `f5b41df`의 양 OS CI 통과 후 public Web3001을
동결 candidate로 교체했다. 실제 gate 경유 Session 요약3Run/1Session·actor403과
HTML/JS·SVG/PNG 자산을 대조하고 원본 DB·다른 서비스·설정 보존을 확인했다.
아래는 구현 계약이며 현재 실행 증거·남은 SSO/GUI 조건은
`demian-public-web-promotion-verification.json`에 기록했다. 위 실행 순서3~4의
공개 웹 교체는 완료했으며 Entra/transport/외부 라우팅은 아직 활성화하지 않았다.

`deploy/demian/promote-public-web.mjs`는 현재 상태를 동결한 private 입력 파일과
그 SHA-256을 받아 `--preflight` 또는 `--execute`로 동작한다. 실행 범위는
Windows의 public Web3001 하나다. 입력의 정확한 CIM identity·listener·보호파일,
동결 candidate/rollback 전체 파일, 암호화 backup과 실제 격리 복원 결과,
현재45테이블의 행·스키마·sequence·보안 catalog를 대조한다. 이 검사가 실패하면
원본 Web을 정지하지 않는다. 과거의 dual-profile `promote-web.mjs`를 사용하지 않는다.

실행은 고유 operation 디렉터리와 exclusive journal/lock을 만든 뒤, 허용한 helper·
공개 startup·활성화·domain metadata만 조건부로 쓴다. 정지 전 의도를 기록하고
현재 프로세스 identity를 다시 검사한다. 시작 출력이 유실되면 같은 operation의
starting/ready receipt와 실제 CIM·명령·listener로 대조하며 중복 기동하지 않는다.
기존 gate를 통과한 HTML·정적 파일·실제 Session의 Track 요약과 actor 거부를
확인하고 나머지 서비스·설정·DB의 보존 검사 뒤 commit한다.

일반 실행 오류에는 알려진 candidate만 종료하고 독립 동결 rollback을 기동한다.
Docker 상태 관측 오류가 fallback 기동 자체를 막지 않도록 복구의 소유권 검사와
정상 전환의 보존 검사를 구별한다. 보존 관측 실패는 결과에 남긴다. commit 후
결과 기록 오류 때문에 정상 candidate를 종료하지 않는다. OS 종료·operator 강제
종료 이후의 자동 재개는 구현 범위가 아니다. 남은 journal·lock·정확한 receipt를
확인하는 수동 복구가 필요하며 같은 입력의 반복 실행은 거부한다.

이 단계는 기존 내부 Basic gate를 보존한 Web 교체다. Entra 활성화·외부 transport·
Cloudflare 경로 변경과는 별도다. 현재 계정의 Cloudflare Access IdP/organization
조회는 `access.api.error.not_enabled`를 반환했다. 기존 Access provider가 있다고
가정하지 않으며 계획한 별도 OAuth2 Proxy 방식으로 계속한다.
