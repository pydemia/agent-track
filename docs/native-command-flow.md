# 원본 접수 영수증의 실행 관계

일반 Native 명령의 owner 원장에서 accepted와 새 Run 관측이 확인된 경우,
현재 Track 계정과 Native·Projects 조회 범위의 교집합으로 후속 관계를 표시한다.
source 구현 단계이며 운영 서비스나 기존 이벤트 원장을 바꾼 작업은 아니다.

| 근거 | 화면 의미 | 별도 확인할 내용 |
| --- | --- | --- |
| Assistant coordinator intent | 재시도 요청·재개 요청 | Native 접수 |
| Native command receipt | 재시도 접수·재개 접수·새 입력 접수 | 새 Run 실행 상태 |
| Native Run metadata | 실제 Run 관측과 현재 상태 | 도구·단계·산출물 |
| Native Run succeeded | 실행 성공 | Projects 검토·업무 수용 |

요청 intent는 기존 점선을 유지하고 Native 접수는 실선으로 구분한다. edge를
선택하면 명령 ID·원본의 접수 시각·`retry_of`/`continues`·출처와 원본 Run 방향을
확인한다. node 상세에도 원본 명령과 논리 root를 표시한다. 접수를 실행 성공,
새로운 agent 호출이나 Projects 업무의 선행 의존성으로 바꾸지 않는다.

## 수집과 권한

현재 owner의 `successor_intents`에서 최근1000개의 accepted·observed 행만 읽고
저장 descriptor와 receipt의 ID·원본 Run·Session·kind·기한을 다시 대조한다.
현재 configured source identity와 계정, 실제 snapshot의 양쪽 Run·Session·workspace,
Native/Projects 조회 범위가 맞을 때만 공개 metadata를 만든다. writer 권한 철회는
과거에 소유한 조회 이력을 취소 권한이나 다른 계정의 실행 권한으로 바꾸지 않는다.

선행 실행을 현재 볼 수 없으면 그 UUID·명령·root 정보를 관계 데이터로 보내지
않고 조회 불가 사유만 표시한다. 직접 연결된 두 Run은 보이지만 오래된 root가
조회 범위 밖이면 root만 nullable로 두고 직접 edge를 유지한다. 없는 Run을 만들거나
숨겨진 root의 식별자를 미관측 node로 노출하지 않는다. 같은 successor의 충돌 receipt,
중복 Run·출처·명령 식별자는 임의로 하나를 선택하지 않는다.

이 metadata는 요청마다 현재 조회 snapshot에만 합성하며 원본 observation, 이벤트·
sequence·digest·cursor에 저장하지 않는다. 같은 화면을 다시 합쳐도 edge·상세가
중복되지 않고 현재 범위에서 철회된 파생 관계는 제거된다. 명령 metadata가 없는
기존 snapshot과 Projects 전용 저장 보기의 동작은 유지한다.

소유자 원장의1000건 조회 창과 제외 여부는 source 설명에 표시한다. 이것은
provider 전체 명령 이력이나 다른 계정이 접수한 실행의 완전한 관계 feed가 아니다.

## 보기별 표현

선택 Run의 mission 흐름은 같은 Native Session 안의 명시한 전후 Run을 탐색해
접수 관계를 잇는다. 이 관계 자체가 Project나 Task 연결을 만들지는 않는다.
계속 실행의 새 root는 기존 Task에 자동 배정하지 않는다. 기존 Task·Session·Run
그룹은 유지하고, 접힌 그룹 사이에서도 원래 edge의 명령 근거를 확인할 수 있다.

Task Map과 묶음 workspace는 현재 범위 안의 Run에만 접수 edge를 합친다.
Trace의 개별 실행 보기에서는 해당 Run의 단계·도구 범위를 유지하고, 선행 실행이
보기 밖이면 그 사실을 상세에 알린다. 다른 Run의 이벤트를 현재 실행의 sequence로
섞지 않는다. 기존 cross-session managed-child·peer·업무 의존 관계와도 구분한다.

## 검증과 후속

실제 로컬 HTTP의 검토·전송·receipt·snapshot에서 같은 Run을 Map으로 연결하는
검사를 추가했다. API/SQLite는 실제 구현이며 Native upstream과 원장 확장용 fixture는
합성값이다. 권한 철회·root 비공개·UUID 충돌·계속 실행의 unbound root·기존 원장 보존·
그룹과 Task Map의 중복 방지·1000건 경계·기존 저장 보기 회귀를 검사한다.
실제 모델·운영 DB·현재 PC의 인증된 화면 수용 검사는 남아 있다.
[최종 파일별 근거](native-command-flow-verification.json)를 따른다.

최종 전체 회귀1,108개 중1,098개 통과·실패0·기존 skip10을 확인했다. 첫 전체
검사의 실패2건은 보존했다. Projects 저장 보기의503은 재현했고, metadata가 없는
기존 snapshot에 영향을 주지 않도록 수정했다. Binding API의404/503 차이는 코드
변경 전 분리 검사에서 재현되지 않았으며 당시 할당 포트가 기록되지 않아 원인을
확정하지 않는다. 해당 fixture에도 기존 Fetch 차단 포트 회피 helper를 적용했으며
제품 요청·assertion·timeout을 재시도하거나 완화하지 않았다.

보호된 Assistant의 제어는 별도 writer grant와 기존 `roleCommand` coordinator에
연결한다. Source 조사에서 기존 SSO가 Assistant 자체 proxy/session·Origin·CSRF를
요구함을 확인했다. Track의 이메일만으로 owner를 대행하거나 읽기 credential을
쓰기 권한으로 재사용하지 않는다. 새 writer는 기본 비활성화, 명시한 owner·Track 계정·
별도 principal·Project/Execution 범위·기한에 묶는다. writer의 intent 저장과 Native
접수는 계속 별도 단계이며 reader의 `controls:false`는 유지한다.

전체 수용15/21·71.4%(상위 동일 가중치·부분0), 전체 ETA 산정 불가·신뢰도 낮음을
유지한다. 운영 반영·writer 연결·실제 제공자와 인증 화면 검증을 source 검사로 대체하지 않는다.
