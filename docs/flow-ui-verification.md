# 업무·실행 Flow 검증

검증일: 2026-11-12 KST. 구현 계획은 `mission-ui-plan.md`, 원본 대조 결과는
`native-flow-verification.json`, 공개 인증 검사는 `track-server-verification.json`이다.

## 자동 검사와 원본 대조

- 전체 테스트164개 통과, 실패/skip0. TypeScript typecheck와 Vite build 통과.
- 실제 Demian Run `d8131c91-8d67-457e-8b95-99bc6c8bfef3`의 원본212event와
  Track212행/cursor212를 대조했다. 별도 인가 lineage9건과 native item/call3쌍이
  정확히 연결됐다. 원본 도구 결과는 성공 보고2개/실패 보고1개이며 API·Flow와
  일치했다. 조회 전후 journal ordinal/digest/payload는 변하지 않았다.
- 요청·실행 시작·종료는 별도 필드다. 이 Run의 도구에는 `tool.started`가 없어
  실행 시작을 미제공으로 표시한다. 요청→종료 관측 구간은 대기를 포함하며
  실제 실행 시간으로 표시하지 않는다. native phase는 별도 lineage 근거다.
- source/Run/call/invocation 식별, 같은 업무의 다중 source·Session, 명시 child
  Run closure, 모호함·int64·부분 조회·한도·원문 제외를 fixture로 검사했다.
- 신규 lineage와 tool BFF는 현재 Run/Session 접근을 전후 재확인한다. 연결된
  Project 철회 전후 차단과 unbound Run 허용을 HTTP native fixture로 검사했다.
  신규 두 경로의 실제 Project 권한 철회 실기까지 완료했다는 주장은 아니다.
- 독립 리뷰의 호출 ID 누락 처리 지적을 회귀 테스트로 재현했다(RED). 식별 불가
  도구 이벤트가 있으면 `complete=false`와 개수 안내를 표시하도록 수정했고
  집중7개 검사(GREEN)와 독립 재검토에서 해결을 확인했다.

## 공개 UI 실기

- Entra 로그인 상태의 `track.pydemia.ai`에서 네 탭을 열었다. Track에는 실제
  업무 연결2개가 각각 고유 Run/세션과 표시됐다. 업무의 Map 버튼으로 같은
  Run을 선택한 Map으로 이동하고 Task ID·당시 revision을 조회했다.
- Trace는 실제6node/7edge를 표시했다. pointer node 선택, Enter node 선택,
  pointer/Enter edge label 선택으로 동일 상세를 열었다. 실패 도구의 결과,
  요청→종료17,954ms, native item/thread/turn/시도·근거 seq를 확인했다.
- 초기200개 근거에서 '흐름의 실행 근거 더 불러오기'로212개까지 읽고 부분
  범위 안내가 해제되는 것을 확인했다. lineage/도구 결과의 별도 조회 범위는
  계속 표시된다. Trail에는 도구2개 성공 보고/1개 실패 보고가 한 항목씩 나타났다.
- Zoom In을 키보드로 실행해 scale0.931395→1.11767을 확인했고, 이후 snapshot
  갱신에도 유지됐다. 전체 맞춤은 명시 버튼으로 실행했다. async 초기 그래프가
  확장될 때 topology별 자동 맞춤을 추가해 node가 inspector 뒤에 가리던 문제를
  수정했다. 카드 header/body와 Handle을 분리해 포트가 본문 스타일을 받는 문제도
  수정했다.
- 390px viewport에서 client/scroll width375/375, canvas/상세345.2px를 확인했다.
  상세는 아래로 배치되고 minimap은 숨겨졌다. 목록의 Task node와 업무 연결 edge를
  Enter로 선택해 상세를 확인했다. 임시 viewport를 reset했다.
- 검증 이미지: `track-flow-trace.jpg`, `track-flow-map-mobile.jpg` (이 작업의 로컬
  visualization artifact). 모의 subagent 화면을 실기 증거로 사용하지 않았다.

## 배포·권한·의존성

공개 미인증 root는 Microsoft 로그인302, API/SSE와 신규 lineage/tools는401이다.
Basic·위조 identity/cookie와 승인·업무 생성 POST도401이며 favicon SVG/PNG/ICO의
실제 bytes/hash는 기존과 일치했다. Node의 특정 Cloudflare socket timeout 후
공개 검증만 OS curl HTTPS로 수행했다. TLS 검증과 운영 네트워크 설정은 유지했다.
인증된 operator hop 검사는 Node fetch를 사용했다.

Pydemia registry source checksum·수정 기록과 React Flow 및 추가 의존성20개의
라이선스 원문을 `vendor/pydemia-ui`에 보존했다. Flow는 동적 import하며 초기
JS406.63kB와 Flow219.61kB로 분리됐다. 이는 minified build 크기이며 체감 성능
측정 결과는 아니다. Vite의 upstream `use client` directive 경고는 남아 있으나
client-only build와 실제 렌더링은 통과했다.

실제 비밀값5종과 당시 저장소의 추적·추가 파일 전체 일치 검사는0건이었다. native tool 인수·
출력·메시지와 Entra/proxy credential은 새 증거 응답·journal에 저장하지 않았다.

실제 goal/cowork/managed-child/peer 조직화, Task dependency의 원본 Link 읽기,
두 번째 장치와 Assistant/desktop workflow는 남아 있다. 전체 goal은 동일 가중치
**13/21 (61.9%)**, 예상 완료 범위 산정 불가·신뢰도 낮음으로 유지한다.
