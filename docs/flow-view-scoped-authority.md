# 일반 Run 그룹 저장 실패와 운영 복원 검증

2026-11-16. 기존 Demian Run을 실제 Entra 계정으로 열어 그룹을 저장하던 중
“저장 보기를 확인하지 못했습니다”가 표시됐다. 원장 읽기 전용 조회에서도
해당 이름의 저장 행은 0개였다. 응답만 유실된 저장 성공으로 해석하지 않았다.

저장 범위는 Projects Task 1개와 일반 Demian Run 1개였다. 그러나 Run이
있다는 이유만으로 `refreshProjectGrants`를 호출해 무관한 Assistant 실행 창까지
다시 수집했다. 이 수집의 원격 지연·실패가 일반 Run의 저장도 막았다.
무관한 Assistant 수집이 실패하는 회귀는 수정 전 503으로 실패했다.

일반 Demian·Codex Run의 저장은 현재 Projects 권한과 해당 Run/Session을
확인하도록 수정했다. Assistant execution 또는 Assistant 소유 Run이 구성에
포함되면 기존 보호 수집을 유지한다. 전후 Projects 확인, 최종 철회·actor/
credential fence, 10초 deadline, CAS와 응답 후 서버 재조회는 보존했다.
timeout 확대·권한 cache·거부 무시는 추가하지 않았다.

수정 source `fefc94f`의 관련 11개, 로컬 전체 1,274개 중 1,263개 통과·실패 0·
환경 제외 11개, 타입 검사·분리 build가 통과했다.
[Windows·Ubuntu CI](https://github.com/pydemia/agent-track/actions/runs/43867575130)도
모두 통과했다. 같은 Track DB 사본에서 후보와 이전 API를 각각 기동해
기존 schema·행·명령 원장과 웹 18개 자산을 대조했다.

운영 API는 `fefc94fffdb61b4df8305fbfd86b51b140a3413f`, 웹은 기존
`186ff8d88b5e42d4f45ce3fda4f889951db7061d`이다. operation
`4bc12d98-1c8c-4d00-8a8f-b29ab472004a`의 전환과 설정 복원을 확인했다.
보존 검사에서 다른 프로세스 18개·파일 47개·웹 18개 자산, SQLite 무결성과
기존 Native 8개 이벤트의 hash·역사 binding r3을 확인했다.
Persona·Entra·원본 Demian runtime과 worker는 변경하지 않았다.

이후 같은 계정으로 실제 Run `82f7e1fd-8fe2-4da1-8307-99f3e016f48c`와
Session `095abfb9-01ad-41b9-beff-38c7e76bb05e`를 열었다. Task 그룹을 접고
`검증 · Demian 실행 보기 · 2026-11-16`으로 저장했다. 성공 메시지와 저장 행
1개·revision 1을 확인했다. 새로고침 뒤 기본 그룹은 펼쳐졌고 저장 보기는
자동 적용되지 않았다. 키보드로 기존 보기를 선택해 불러오자 현재 권한으로
복원했다는 메시지와 접힌 Task 그룹이 함께 확인됐다. 정규 이벤트는 17개다.
이 저장 보기는 사용자 계정에 남겨 두었다.

앞선 동일 웹에서는 기존 Run 묶음을 Track·Trail·Trace·Map으로 전환해 구성원
유지를 확인했다. 일부 상세 조회 실패도 있어 전체 관측 안정성으로 확대하지
않는다. 새로고침 때 네 보기의 임시 공통 범위를 보존하는 기능과 계정별 표현
저장은 서로 다르다. 이번에 확인한 저장은 일반 Run/Task의 표현 상태다.

[운영·GUI 근거](flow-view-scoped-authority-operating.json)에 revision·범위·검사와
한계를 연결했다. AT-12-G06의 일반 Run 실제 계정 저장·새 접속·복원은 확인했지만
peer 대표선 포인터와 보호 Assistant 범위의 안정적 수용은 남는다. 상위 수용은
15/21·71.4%를 유지하며 전체 하위 분모·완료 ETA는 아직 산정하지 않는다.
Persona `90e0825 / 33e19141`의 새 CI 예외 승인은 대기 중이다.
