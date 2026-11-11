# Projects 업무 의존 관계 읽기

Projects의 실제 `Link.relation=depends_on`을 Track Map에 연결한다. 업무와 관계의
원본은 Projects이며 Track은 관계를 생성하거나 Task 완료를 변경하지 않는다.

## 계약과 인가

기존 서명 API에 optional capability `taskDependenciesRead`와
`GET /api/integrations/assistant/v1/projects/{project_id}/task-dependencies`를 추가한다.
기존 `projects:read`·`tasks:read`를 모두 요구하며 principal·scope·key를 추가하지 않는다.
요청 Project뿐 아니라 관계 소유 Project·출발 업무 Project·도착 업무 Project가
현재 native ACL과 principal 범위의 교집합 안에 있어야 한다. SQL에서 이 조건을
적용한 후 ID 정렬·200건 한도를 적용한다. `has_more`는 추가 관계가 있음을 나타낸다.

응답은 관계 ID·소유 Project·양쪽 Task의 현재 metadata와 관계 기록 당시 revision을
포함한다. Task 본문·Link review는 조회하지 않고, 원문·도구 인수·출력은 반환하지 않는다.
`observed_at`은 이번 읽기 시각이며 업무 성공이나 전체 이력 완전성을 의미하지 않는다.

Track adapter는 별도 read-only credential로 고정 GET만 서명하고 응답 크기·ID·revision·
관계 종류·중복·자기 참조를 검사한다. 이전 원본에 capability가 없으면 `supported=false`를
반환하며 빈 관계와 구별한다. Track API는 source identity·사용자와 native Project 권한을
조회 전후 재검사한다. 양쪽 endpoint나 소유 Project가 철회되면 관계 전체를 반환하지 않는다.

## 소스와 배포

`provenance.json`은 현재 context layer의 base image와 기존 producer 파일 hash를 기록한다.
원본 Projects checkout에는 다른 WIP가 있으므로 수정하지 않는다. 검증된 분리 snapshot에
`src/`·`tests/`를 복사하고 `git apply --unidiff-zero native.patch`로 작은 patch를 적용한다.
기존 context BFF·web source·SDK에는 변경이 없다.

`scripts/package-projects-dependencies.py --output .runtime/projects-dependencies/<새 release>`는
baseline의 다른 파일, 공개 patch 재적용 결과와 검사한 소스의 byte 일치를 확인하고 API
두 파일만 고정한다. Linux의 `deploy/projects/deploy-dependency-layer.py --release <private
release> --execute`는 exact base image 위에 이 두 파일을 추가한다. companion
`dependency_layer_policy.py`를 같은 private 배포 디렉터리에 둔다.

기존 DB online dump를 검증한 뒤 app만 재생성한다. DB schema·ingress·환경·mount·
command·user·entrypoint·private mount hash를 유지한다. 실패 시 검증 당시의 resolved
설정을 별도 private 파일로 고정해 복원한다. 원래 compose 파일의 사후 변경을 사용하지
않으며, replacement가 생기지 못한 경우에도 복원한다. 다른 image·설정의 container는
덮어쓰지 않는다. 자동 DB restore·downgrade는 없다.

현재 운영 compose는 private release
`20261112-agent-track-dependencies-33dfdfe3c12a0ffb/runtime.compose.json`이다.
과거 context-only compose를 현재 배포 설정으로 사용하지 않는다.

## Map 표현과 검증

Track 업무 목록의 `업무 Map` 또는 업무별 실행 조직의 `업무 의존 Map`에서 연다.
원본 A `depends_on` B는 화면에서 B→A의 `선행 조건` 화살표로 표시하고, 관계 상세에
원본 방향·ID·현재 revision·관계 기록 revision을 함께 남긴다. 업무의 현재 상태와
명시적으로 연결된 Run·Session은 별도 node다. 의존 관계에서 Run binding·실행 배정·
완료를 추정하지 않는다. 같은 source+Project+Task의 실제 binding만 연결한다.

조회 한도·미지원·연결 실패·관계 없음은 구별한다. 선택 업무와 무관한 관계를 대신
보여주지 않는다. 404·권한 철회는 그래프와 Task URL 문맥을 제거하며, 지연 응답을
버린다. 모바일·키보드·뒤로/앞으로 이동과 실제 7→6→7 읽기 범위 철회를 대조했다.

PostgreSQL 전체437개와 보강한 focused7개, Track264개, 배포 복원 정책3개 검사를
수행했다. 전체437개 이후에는 runtime source를 변경하지 않고 검사 사례만 보강했다.
자세한 운영·브라우저 범위와 한계는 `docs/projects-dependencies-verification.json`에 있다.
