# AT-14 재점검 — 2026-11-18 KST

원래 수용 조건은 `product-plan.md`의 “Assistant 지시→Demian 실행→desktop 접속→Track 검토의
실기 시나리오 통과”다. 별도 desktop 앱/SDK, Projects Task 자동 수용, step/tool 식별자 생성,
새 Entra 로그인이나 전체 업무 재생성을 필수 조건에 추가하지 않는다.

| 원래 흐름 | 재사용 가능한 실제 근거 | 이번 변경의 영향과 현재 판정 |
| --- | --- | --- |
| Assistant→Demian 실행 | `workflow-observation-2026-11-14.json`: 같은 Execution/Note operation 재개, Note 원문 hash·첨부2개·색인과 Projects 결과·Note 참조 확인 | 재생성 없이 completed Execution r72를 현재 인가된 API로 재조회. Task r5/in_review와 실행 완료는 구분 |
| 현재 Windows PC 접속 | `assistant-workflow-observation-20261116.json`: 실제 Edge Entra 로그인, 동일 Execution과 Run 선택·그룹 내부 탐색 | 기본 Entra·owner·기기 범위를 유지. 새 로그인 자체를 게이트로 추가하지 않음 |
| Track 그룹·Trace 검토 | `projects-read-transport-deployment-verification.json`: 실제8events·4nodes/3edges/3groups·모델·usage·산출물·Native edge seq4,5 확인 | 렌더러와 근거 투영은 이번 웹 수정에서 바뀌지 않아 기존 시각/관계 근거를 재사용. 단, 당시 첫404·일시 단절로 선택이 사라진 반증도 유지 |
| 단절 뒤 새 인가로 선택/상세 복구 | 웹c52b49d의 `App.tsx`·`run-selection.ts` 변경. 수정 전 회귀2개 실패, 관련5개·전체/양 OS CI 통과. 컴파일된 합성 Edge에서 단절 비노출·복구 GET1→2·철회 후 제거 확인 | 이 동작은 이번에 바뀐 UI 경계다. 실제 운영은 API15개200·SSE90초30개/5분100개 전부 connected로 안정성 하위 조건 통과. 최신 실제 화면의 선택·Trace 복구까지 실행했다고 주장하지 않음 |

후속 실기에서 AT-14를 수용했다. 별도 Edge157/headless 1440×960에 현재 운영
API047b4d6·webc52b49d와 인가된 실제 같은 Execution을 연결해8events·4nodes/
3edges/3groups를 읽었다. Native turn node·turn/item edge의 출처와 seq4/5 상세,
그룹 접기/펼치기·Run 내부 탐색·이전 탐색 복원7동작이 통과했다. fixture 응답이나
새 업무를 만들지 않았다. [해당 revision·동작·화면 원본](operating-flow-review-verification-20261118.json)을 따른다.

이는 기존 인가된 로컬 proxy identity의 현재 운영 데이터 실기다. 기본 Entra·owner·
인증 설정을 바꾸지 않아 이전 실제 Entra desktop 근거를 재사용했다. 기존 사용자
Edge 창 입력은 GetCursorPos Access denied로 여전히 수행하지 못했다. 이 제약을 새
로그인이나 제품 인증 실패로 바꾸지 않는다. 단절/철회 회귀는 기존 단위·합성 UI와
현재 운영 API/SSE 안정성 근거로 구분하며 새 운영 장애를 유발했다고 주장하지 않는다.
원래 교차 앱 조건에 특정 창의 수동 조작·새 SSO 로그인·실제 운영 장애 유발·과거503
원인 확정·무기한 무장애를 추가 완료 조건으로 붙이지 않는다.

명령 기능 AT-09의 writer 권한·원본 제공자 계약, AT-12의 peer 대표선 선택, AT-15의 여러
장치·필터 초기화, AT-06/20의 원본 Session·문맥·장애 격리는 각각의 요구에 남긴다.
이 항목들을 AT-14의 조건으로 전파하지 않는다.

[현재 운영 검증](post-reboot-deployment-verification-20261118.json),
[선택 복구 검사](run-selection-recovery-verification.json),
[현재 명령 설정](command-boundary-after-reboot-20261118.json)을 따른다.
