# Demian 대화의 Agent Track 실행 요약

기존 Demian 대화에서 해당 Session의 관측 Run 수·실행 상태와 Track Map 링크를
펼쳐 볼 수 있는 선택적 통합이다. 실행 제어·권한 결정·대화 입력은 기존 Demian이
소유한다. Track의 요약 장애가 실행이나 대화 입력으로 전파되지 않도록 분리한다.

## 소스와 적용

`provenance.json`은 기존 native Next build `gULRpDkjzmL9RnPCwAF-4`와 설치된
source map 65파일의 일치, 독립 baseline 재빌드의 동일 정적 자산26개, 수정 대상
원본 hash를 기록한다. 원본 Demian checkout의 다른 WIP는 수정·배포하지 않는다.

분리 snapshot에 이 디렉터리의 `apps/` 파일을 복사하고 `native.patch`를
`git apply --unidiff-zero`로 적용한다. patch 대상은 ChatClient의 optional panel,
web의 zod dependency와 lockfile이다. `packages/context/{client.ts,contracts.ts,
ExecutionSummary.tsx}`와 `packages/contracts/index.ts`는 각각
`apps/web/src/track-shared/context/`와 `.../contracts/`에 복사한다. 원본 ES2017
설정에 맞춰 int64 상한의 bigint literal만 `BigInt("9223372036854775807")`로
표현한다. 실제 숫자·검증 규칙은 같다.

```powershell
npm run test --workspace=@demian/web
npm run typecheck --workspace=@demian/web
npm run build --workspace=@demian/web
```

`scripts/package-demian-context.py --output .runtime/demian-context/<새 release>`는
원본 build·baseline·공유 SDK·허용한 변경을 대조하고 표준 Next build를 실행한다.
standalone·static·public의 전체 파일을 고정하고 정확한 파일 집합과 hash를 manifest에
기록한다. 운영 비밀값이나 원본 checkout 전체는 포함하지 않는다.

## 인증과 장애 경계

`DEMIAN_TRACK_CONTEXT_FILE`이 없으면 disabled다. 현재 통합은 기존 loopback
trusted owner 배포에만 opt-in한다. native actor·organization·role·auth mode와
Session/workspace를 고정하고, native `/me`·Session 권한을 Track 조회 전후 확인한다.
브라우저의 actor/organization header는 동일 문맥 확인용이며 인가 근거가 아니다.
서버 cookie가 있으면 해당 credential이 우선하며 잘못된 cookie를 서버 key로
대체하지 않는다. Origin/Host·현재 private config fingerprint도 확인한다.

기계 reader key는 서버의 private file에서만 읽는다. 브라우저·URL·public bundle에
넣지 않는다. 현재 QA Session 두 개에만 허용하며, 다른 사용자에게 owner key를
빌려주지 않는다. 공개 Demian의 기존 Basic gate는 이 기능에서 변경하지 않는다.
Track의 Entra 로그인과 Demian 원본의 인증은 별개이며 AT-06의 원본 인증 연결은 남는다.

서버는 native 조회500ms, shared Track 조회2초·512KiB 한도를 적용한다. panel은
4초 hard deadline과 이전 요청 완료 후15초 polling을 사용한다. Session/계정 변경,
권한 철회·단절·손상 응답 때 이전 요약과 링크를 제거한다. 늦은 응답을 버리고 reader를
정리한다. 재시도는 요약만 다시 읽으며 native 명령을 보내지 않는다.

## 운영 적용 도구

`deploy/demian/promote-web.mjs --preflight --release <private release>`는 원본
web·API·worker·gate·tunnel identity와 startup patch를 확인한다. `--execute`는
검토된 산출물의 명시적 적용 단계다. 기존 DB의 online dump를 검증하고, 원본 web을
독립 fallback으로 고정한 뒤 local/public web 두 프로세스만 교체한다. API·worker·DB·
gate·tunnel은 교체하지 않는다. optional startup dispatch는 검증된 private release만
사용하고 opt-in이 없거나 검증이 실패하면 원본 web을 선택한다.

동시 promotion은 create-only lock으로 차단한다. metadata는 Windows exclusive
handle 아래 원본 hash를 비교하고 수정한다. 실패한 in-place 쓰기는 같은 handle에서
기존 bytes를 복원하며, 새 파일은 완성된 stage를 no-overwrite로 게시한다. 복구는
활성 release 소유권을 먼저 확인한 후 profile별로 수행한다. 한 profile의 외부 충돌이
다른 profile의 복구·PID metadata 기록을 막지 않는다. 복구한 identity와 개별 실패는
private recovery-state에 남긴다. DB restore나 downgrade는 자동 실행하지 않는다.

QA clone에서120개 native web 검사와 실제 장애 중 Run 실행·자동 요약 복구·390px·
키보드·동일 공개 Map 이동을 확인했다. 원본 운영 적용 여부는
`docs/demian-context-native-ui-verification.json`의 production 항목과 구별한다.
