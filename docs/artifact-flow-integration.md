# Run 그룹의 산출물 근거

기준: 2026-11-12 KST. AT-12의 node group·깊이 탐색에 실제 Demian
산출물 metadata를 추가한다. 기존 최근 Session 목록 API를 사용하며 원문·다운로드를
요청하지 않는다. 새 Run·Task·모델 실행이나 원본 데이터 변경은 없다.

## 표현과 탐색

- Map은 Session → Run → 산출물, Trace는 Run → 호출·도구·산출물로 탐색한다.
  기존 개요·구조·상세 깊이, 접기/펼치기, 내부 흐름, breadcrumb, 원본 목록을 사용한다.
- 원본 `kind: result`는 Run → 산출물의 `artifact-output` 실선으로 표현한다.
  `attachment`는 `artifact-association` 점선이다. 첨부 귀속만 확인하며 실행 입력·
  인과·의존 관계를 추정하지 않는다. 소비 Run 연결은 별도 원본 계약이 필요하다.
- artifact의 source-qualified ID와 실제 Run/Session ID가 일치할 때만 기존 Run
  그룹의 구성원으로 추가한다. Run 개수·성공 여부·Projects 수용 상태를 바꾸지 않는다.
  상태는 관측 참조이며 node 상세에 종류·파일 이름·MIME·크기·SHA-256·표현·생성/
  관측 시각·Source/Run/Session ID·조회 범위를 표시한다.
- 기존 event 참조는 동일 identity·scope·metadata가 모순되지 않을 때 보강한다.
  sequence 출처는 별도로 유지한다. 다른 Run이나 모순된 metadata는 합치지 않는다.
- 권한 철회·조회 실패·actor/Run/binding 변경 때 이전 metadata와 상세를 제거한다.
  나중에 같은 산출물이 다시 조회돼도 이전 선택을 자동으로 복원하지 않는다.

## 조회와 권한

`GET /api/runs/:runKey/artifacts`는 query·GET body를 받지 않는다. 현재 Track
actor·source membership·원본 연결·bound Projects 권한 교집합을 확인한다.
Projects 갱신, native Run 조회, artifact 목록, 마지막 Projects 갱신과 native
Run 재조회에 전체 10초 기한과 caller abort를 적용한다. 반환 직전 source identity,
credential 파일 내용 변경, binding·현재 actor/Run/Projects scope를 다시 확인한다.
서로 다른 서비스의 권한을 원자적 transaction으로 읽는 계약은 아니다.

native JSON body는 1 MiB·strict UTF-8·application/json으로 제한한다. 원본 응답의
추가 필드는 DTO에 복사하지 않는다. 브라우저는 strict metadata schema와 exact Run/
Session을 검증하고 같은 origin의 GET만 사용한다. 비밀값·raw body·schema 오류는
오류 문구에 포함하지 않으며 metadata를 이벤트 원장이나 별도 cache에 저장하지 않는다.

## 범위와 검증

Session 최근 100개 목록에서 현재 Run에 속한 미철회 항목만 표시한다. 항상
`complete: false`이며 과거 전체 산출물·다른 Run의 입력 관계·다운로드 가능성을
의미하지 않는다. live 근거는 기존 `answer.txt` result 1개다. 16개 전체 원본 artifact를
모든 Run의 출력으로 간주하지 않는다.

회귀 검사는 결과/첨부 구별·그룹 소속·충돌/잘못된 metadata·권한/credential 변경·
최종 갱신 중 native 철회·body/전체 기한·브라우저 exact scope를 포함한다. 분리
합성 UI의 2개 산출물과 실제 native readback을 구분하며 실제 child/peer 실행의
완료 증거로 사용하지 않는다. 전체 goal은 동일 가중치 14/21(66.7%)을 유지한다.
