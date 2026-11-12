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
실제1538개 파일을 현재 manifest와 다시 대조했다. candidate 검증은 현재 서비스의
교체나 독립 rollback release 확보를 뜻하지 않는다.

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
   현재 DB/설정 보존 기준, 검증된 최신 암호화 backup과 동결 rollback을 연결한다.
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
