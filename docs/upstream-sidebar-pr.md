# 원본 AgentTrail SNB 수정 PR

2026-11-11 KST.

- 원본 PR: https://github.com/sodiumsun/agenttrail/pull/21
- 제출 계정: pydemia. GitHub 응답의 author.is_bot=false 확인.
- fork: https://github.com/pydemia/agenttrail
- 브랜치: `fix/sidebar-responsive-columns`
- 커밋: `e25d8486e57bdf227a8c8b24e037abd69e088e48`
- GitHub commit author/committer 연결 계정과 Git 이름: 모두 pydemia. 개인 이메일 대신 GitHub noreply 사용.
- 작업 공간: `C:/Users/pydemia/git/agenttrail-contrib`. 원본 설치 checkout·운영 daemon은 유지.
- 상태: 초안 PR, OPEN, MERGEABLE. 원본 Map workflow는 `action_required` 상태이며 로컬/격리 검사의 통과를 원격 CI 통과로 간주하지 않음. 병합 미실행.
- 원본 CI: https://github.com/sodiumsun/agenttrail/actions/runs/42932042666

## 제출 범위

원본의 721–960px media rule에서 잘못된 grid column override만 제거했습니다. 기본272px SNB와 가변 지도 열을 상속하며 720px 이하의 원래 stacked layout은 유지합니다. 재현 문서와 기존 PLAN의 완료 항목을 포함했습니다.

현재 원격 서비스의 전체 프로젝트 제목·Entra·gateway·접기·리사이즈 기능은 PR에 포함하지 않았습니다. 이들은 원본 CSS 버그와 별개인 표시 보정·기능 확장입니다.

## 확인 결과

- 원본/패치의 합성 저장소를 각각 격리된 포트와 HOME에서 실행하고 Edge로 비교. 사용자 저장소·로그·연결 설정을 공개 재현에 사용하지 않음.
- 956px: 원본668/288px → 패치272/684px(SNB/지도).
- 패치721/960/1440px: SNB272px 유지 및 나머지 지도 공간 확인.
- Linux 격리 container, Node24.21.0: 전체230개 중229통과·0실패·1skip(PTY setup case).
- `node --check`, leak scan, `npm pack --dry-run`, Git diff whitespace 검사 통과.
- 초안의 title/body/head/base/author와 실제 파일3개를 재조회해 확인. 프리뷰 daemon2개는 해당 command line을 확인한 뒤 종료.
