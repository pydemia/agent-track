# AgentTrail SNB 수정

2026-11-11 KST. 사용자 보고: 왼쪽 SNB가 화면을 대부분 가리고 크기 조절·접기가 불가능함.

## 원인

설치된 원본의 desktop grid는 `272px minmax(0,1fr)`인데, `@media(max-width:960px)`에서 `minmax(0,1fr) 288px`로 바뀝니다. 현 DOM의 첫 열은 SNB이고 두 번째 열은 지도이므로 956px 화면에서 SNB668px·지도288px가 되어 열 역할이 뒤바뀝니다. 설치본에 SNB 전체 접기나 너비 조절 control도 없었습니다. 초기 다중 프로젝트 배포의 화면 검수에서 이 반응형 문제를 놓쳤습니다.

## 수정

원본 checkout을 변경하지 않고 인증 gateway의 기존 표시 adapter에 `trail-sidebar.css`·`trail-sidebar.js`를 추가했습니다. React 기반 pydemia UI registry source를 vanilla 원본 페이지에 편입할 호환성이 없어 native button·separator와 기존 색상 token을 사용했습니다. favicon·API·Entra·세션 패널·관측 데이터는 변경하지 않았습니다.

- 일반 화면: 기본 SNB256px, 남는 공간은 지도에 배정. 960px 이하에서도 동일한 열 의미 유지.
- 헤더 **프로젝트** 버튼: 전체 SNB 접기·펼치기. 접히면 지도가 전체 너비 사용.
- SNB 오른쪽 경계: drag로 너비 조절, 좌우 화살표16px, Home/End로 범위 끝으로 이동. 경계 두 번 클릭은 기본256px 복원.
- 너비180–420px 및 화면 비율42% 상한으로 지도를 보호. 좁은 화면 drawer에는 별도 화면 너비 상한 적용.
- 720px 이하: 기본 접힘, 프로젝트 버튼으로 drawer 열기, 배경 또는 Escape로 닫기. Escape 후 focus는 프로젝트 버튼으로 복귀.
- 너비·접힘은 해당 브라우저의 origin별 localStorage에 보존. 저장소 사용이 차단돼도 현재 페이지 control은 동작.
- 오른쪽 Runs overlay는 요청한 SNB와 다른 영역이며 기존 동작 유지.

## 실제 브라우저 확인

| 조건 | 결과 |
| --- | --- |
| 수정 전 956px | SNB668 / 지도288 |
| 수정 후 956px 기본 | SNB256 / 지도700 |
| 전체 접기 | SNB display:none / 지도956 |
| 좌우 화살표 | 256→272→288, 새로고침 후288 유지 |
| Drag | 288→320, pointer 종료 후 dragging state 해제 |
| 경계 두 번 클릭 | 320→256 복원 |
| 접은 후 새로고침 | 접힘 유지, 지도956 |
| 390px 화면 | 기본 접힘, 지도390, 페이지 scrollWidth390 |
| 390px drawer | SNB288 열림, backdrop 표시, Escape 닫기·toggle focus 복귀 |
| 1440px 화면 | SNB256 / 지도1184 |

검사 후 viewport override를 해제하고 기존 dark theme와 기본256px·펼침 상태로 복원했습니다. 전체 프로젝트11개 표시를 유지합니다. 모바일 실제 장치 터치·다른 브라우저는 미검증입니다.
