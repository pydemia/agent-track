# 구현 QA 기록

기준: 2026-11-11 KST · 미커밋 v0.1.0 구현. 최종 revision은 Git 기록과 대조한다.

## 검사 결과

| 검사 | 결과 | 한계 |
| --- | --- | --- |
| `npm test` |17개 통과·실패0·skip0 | source fixture는 실제 Demian 실행으로 계산하지 않음 |
| `npm run typecheck` | 통과 | TS5.9.3·Node24.21.0 |
| `npm run build` | 통과 | React19·Vite8, 현재 dist/web |
| native source 계약 | Demian/Projects/Assistant 실제 코드 조사 | source 조사와 운영 credential/권한은 별개 |
| 실제 Codex 수집 | 최근100파일, 212 Run·5저장소 확인 | 7일·파일/크기 제한. native Demian 연결 아님 |
| Source 상태 | Demian 인증 필요, Projects/Assistant/desktop 미지원 표시 | 모의 성공/원문 fallback 없음 |
| 공개 인증 | `/`302 Microsoft, API/SSE401, Basic·위조 identity401 | 첫 본인 consent·callback·logout 대기 |
| favicon | 실제 upstream SVG/PNG/ICO200·형식·bytes/hash build 일치 | 인증 후 공개 응답·실제 탭 표시 미검증 |
| 운영 Trail 보존 | 미인증 `/`302 Microsoft 유지 | 기존 Trail 실기 기록 별도 |
| actual online backup | private 상태 폴더 새 backup 생성·integrity ok | 운영 복원 전환은 하지 않음 |

## 브라우저 실기

공개 동의 대기 중 분리된 loopback QA: `scripts/preview-track.ts`, port14347.
실제 product DB를 조회하되 source collector를 시작하지 않는다. 따라서 출처는
연결 끊김/미지원이고 SSE는 QA 서버의 원장 조회 연결이다. 합성 실행 데이터를
삽입하지 않았다. 인증 우회를 공개 route에 연결하지 않는다.

- 초기 전체5저장소 목록과 source/device/관측 시각 확인.
- Demian 저장소 필터5 Run, 지정 대화 Session ID가 실제 원장에 일치.
- Run 선택·Trace·Trail metadata, 뒤로 가기, 필터 해제 후 같은 선택·전체212행 복원.
- SNB960px: sidebar244/main700.8, 접힌 main944.8. 본문 누락 회귀 수정 후 확인.
- range 포인터272px, 키보드+4px, 새로고침 후272px 복원.
- 390×844: 기본 닫힘·가로 overflow 없음, drawer340px,
  Shift+Tab은 마지막 slider로 순환, Escape 후 opener로 focus 복귀.
- viewport 임시 override reset. 원본 명령 버튼은 비활성·미지원으로 유지.

## 리뷰와 수정

독립 backend review는 source kind를 같은 ID로 교체했을 때 cached connected
상태가 남는 문제를 재현했다(기존16통과+신규1실패). durable source identity
pin과 현재 config 일치 검사를 추가해 회귀17검사를 모두 통과했다.

부모 UI 검토에서 desktop collapse grid0열·이벤트 추가 paging race·source 인가
철회 후 UI cache 잔류 가능성을 확인했다. 단일 grid열, 요청 취소/generation,
실시간 tail 조회,401/403 및 `authorization_revoked` 시 private state 제거를
구현했다. SNB는 실기 확인했으며 인가 철회 UI 실기는 후속 검사다.

## 전체 수용

[goal 기준표](goal-status.md)의 2/21(9.5%)이다. 테스트 개수·코드량·배포 경로
준비를 제품 전체 완료율로 사용하지 않는다. 남은19개 조건과 예상 갱신 기준은
해당 표와 개발계획에 유지한다.
