# Agent Track Projects 조회 지연과 사설 transport 후보

2026-11-16 확인. 운영 Track API는 `05c1833`, web은 `186ff8d`,
Persona는 승인된 source `4a9ad42` / image `b68ece66`이다.
새 후보는 아직 운영에 반영하지 않았다.

## 진행이 멈춘 경계

기존 실제 업무의 SSE 수집은 Native metadata 두 번과 최종 Projects 권한
재확인 중 10초 deadline을 초과했다. 해당 업무는 Execution r72/completed,
Task r5/in_review이며 Note 입력 0개·역할 1개·successor plan 0개다.
이 표본에서 Note 재조회가 지연의 직접 원인이라는 가설은 제외했다.

승인된 운영 이미지의 원래 SignedProjectsProvider에서 같은 소유자·Task를
읽었다. 공개 Projects 경로의 3회 조회는 2,066 / 2,360 / 1,736ms였다.
각 Native metadata RPC는 앞뒤로 원본 Task를 확인하므로 이 왕복이 반복된다.
원본 권한 검사나 10초 deadline을 제거하는 방향은 채택하지 않았다.

## 구현과 실측

Persona에 서버 설정 `PERSONA_PROJECTS_READ_TRANSPORT_ORIGIN`을 추가했다.
명시한 경우에만 Task·capability GET을 사설 전달기로 보내며 논리적인
Projects origin, 소유자 HMAC·binding·key·method/path/body 서명과 응답 후
현재 binding 검사를 유지한다. 쓰기·다른 조회·query는 기존 HTTPS 경로다.
실패 시 우회 재시도·권한 cache는 추가하지 않았다.

Agent Track의 `deploy/projects/read_transport_relay.py`는 고정 loopback
Projects edge에 해당 GET만 전달한다. 원본 Projects가 현재 서명·ACL을
검사한다. 전달기에 credential·응답 저장 기능은 없다. 쓰기·Cookie·forwarded
신원 헤더는 차단하며 동시 요청 8개·응답 40MiB·원본 읽기 10초로 제한한다.

컴파일한 새 client와 실제 전달기를 기존 소유자·같은 Task에 연결한 첫
측정은 72 / 27 / 11ms, 최종 전달기 재측정은 87 / 13 / 13ms였다.
모두 HTTP 200·Task r5/in_review다. 원래 Persona 프로세스를 교체한
결과는 아니다. 임시 전달기는 종료했고 새 credential·모델 실행·명령 전송과
원래 Persona Work/Runtime DB 변경은 없다. 원본 GET의 통상 접근 기록까지
쓰기 0으로 주장하지 않는다.

## 후보와 검증 상태

- Persona source: `90e082510adee7e8e29c058490066cb86efcfdcc`
- 후속 draft PR: [Persona #23](https://github.com/pydemia/persona/pull/23)
- 이미지: `sha256:33e191418c96de6f95f6451c910c2ac3378889b566e3d3734cc1d371c8a0e449`
- 전달기 SHA-256: `ed933a881a2204ad0ced4939977d59635c3481cb679d995e0320e2c40c52073a`
- 새 client·기존 관련 검사 51개, 타입 검사·전체 build 통과
- 전달기 실제 HTTP 검사 8개와 기존 Python 검사 합계 49개 통과
- 최초 Track CI의 Windows 포화 검사는 503 응답 전 연결 reset으로 실패했다.
  미수신 요청 header를 남기고 닫는 경계를 수정했다. 거부 처리에서 header를
  최대 16KiB·100ms만 읽고 503을 반환하며 upstream에는 전달하지 않는다.
  로컬 49개와 수정 후 실제 조회를 재확인했으며 새 양 OS CI를 대기한다.
- Windows 전체: 1,345개 중 1,329 통과 / 2 실패 / 14 제외
- 동시 실행 수 2의 Windows 전체: 1,330 통과 / 1 실패 / 14 제외
- 최초 실패한 두 파일의 분리 실행: 24개 모두 통과

남은 Windows 전체 실패는 압축 복구 CLI 검사다. 수정 전 `4a9ad42`의 별도
checkout에서도 복구 검사 실패를 확인했다. 현재 C: 여유 공간 약 0.9GB는
CLI가 요구하는 1GiB 예비 공간보다 작다. 전체 검사를 통과했다고 기록하지
않으며 새 소스의 회귀라고 단정하지 않는다. 임시 작업 파일 삭제는 자동
승인 검토에서 거절되어 수행하지 않았다. 충분한 공간의 격리 Linux 환경에서
동일 후보의 build·타입·서식·전체 검사를 진행 중이다.

새 소스의 [push CI](https://github.com/pydemia/persona/actions/runs/43862473033)와
[PR CI](https://github.com/pydemia/persona/actions/runs/43862557819)는 모든 job이
검사 단계 시작 전에 실패했다. GitHub annotation은 계정 결제 실패 또는
지출 한도 조정을 사유로 표시한다. 로컬 결과를 CI 통과로 대체하지 않는다.

## 운영 반영 전 남은 조건

후보 빌드 전후 원래 Persona container·image·PID·시작 시각·설정 보존을
확인했다. 사설 전달기 후보는 기존 bridge의 `172.25.0.1:14325`이며
rootless subnet과 겹치지 않고 전용 port가 비어 있었다. 해당 bridge는
다른 앱의 기존 network이므로 이름·ID·인터페이스를 pin하고 lifecycle 의존성을
명시해야 한다. 기존 network 변경이나 공개 listener 추가는 하지 않았다.
운영 listener·systemd unit·새 Persona 환경 설정은 아직 없다.

새 이미지의 CI 예외는 기존 `4a9ad42 / b68ece66` 승인에 포함되지 않는다.
실제 전환 전 정확한 후보·설정 변경 한 항목·원래 이미지/환경과 복구 계획,
현재 상태에 맞는 기존 전환 runbook의 증거를 대조한다. DB·인증 복원과 writer
활성화는 이번 변경에 포함하지 않는다.

배포 뒤 같은 실제 업무의 반복 snapshot/events/evidence, SSE와 그룹·Trace,
네 보기 왕복을 확인해야 한다. 현재 상위 수용은 15/21·71.4%로 유지한다.
reader 운영은 확인됐지만 업무·그룹/Trace 안정성, 명령·복구, 저장 보기·peer,
다중 장치·원본 앱 이동은 남는다. 전체 필수 하위 항목 분모와 전체 완료 ETA는
아직 산정하지 않는다.
