# Native 실행 명령의 구현 단계

원본 Demian의 `d3ffeb9d5207a65bd0498a576410c3d1596acc9b`에 명시적 명령 접수와
복구를 추가했다. 현재 단계는 **소스 구현·격리 검증**이다. 운영 DB migration이나
Native/Assistant/Track 교체는 수행하지 않았다.

| 명령 | 원본 상태 | 업무 입력·root | 후속 관계 |
| --- | --- | --- | --- |
| 실패 재시도 retry | failed | 원래 논리 입력·root 유지 | retry_of |
| 중단 작업 재개 resume | cancelled, expired | 원래 논리 입력·root 유지 | continues |
| Session 계속 실행 continue | terminal | 명시한 새 입력·새 root | continues |

기존 Run의 상태·이벤트·메시지·usage·receipt는 변경하지 않는다. 후속 Run,
불변 명령 receipt와 `run.command.created` 관계 이벤트를 같은 transaction에
저장한다. 승인 대기는 기존 permission 결정 경로와 worker/attempt/lease fence를
사용하며 일반 resume로 자동 승인하지 않는다.

Native의 context 조회는 원본 상태, Session head와 현재 권한 stamp를 반환한다.
접수는 그 관측값·command ID·전체 intent·기한을 고정한다. 같은 ID/같은 intent는
기존 receipt를 반환하고, intent가 다르면409다. 같은 head의 동시 명령과 일반
enqueue 경합으로 활성 Run을 둘 만들 수 없다. COMMIT 응답 유실은 `outcome_unknown`
이며 같은 명령 ID로 조회한다. 다른 Run의 존재나 새 key로 복구하지 않는다.

보호된 실행의 새 operation context는 기존 packet 본문을 보존한 signed envelope로
전달한다. 현재 binding·역할·키·정책·prepared pin을 transaction 안에서 다시
검사하고 복구에도 같은 operation 증명을 요구한다. 일반 개인 연결과 deployment
권한을 구분한다. 배포 Run은 별도 개인 로그인 회전의 영향을 받지 않으며, 배포
권한 철회 시에는 조회·접수를 거절한다. read-only Track reader의 권한은 늘리지 않았다.

Track에는 서버용 strict contract와 일반 owner용 transport를 추가했다.
정해진 context/접수/복구 경로, source·Session·명령·kind·기한을 대조하고 긍정
receipt만 받는다. durable409 거절과 `not_found`를 구분하고 응답 유실 시 자동
재접수하지 않는다. 이 메서드는 아직 사용자 제어 route나 버튼에 연결하지 않았다.
권한 stamp는 브라우저 receipt로 내보낼 데이터가 아니다.

공개 signed transport gate의 소스 allowlist에도 이 세 경로를 추가했다. 기존 bearer와
서명 요구, 정확한 method/path·본문 바이트·header 격리·기한은 유지한다. 잘못된
UUID·method·query는 upstream 전에 거절한다. 관련14개 검사와 타입 검사를 통과했다.
운영 중인 gate는 교체하지 않았으며 새 사용자 권한이나 reader 제어 권한을 만들지 않았다.

실제 PostgreSQL17.11 격리 검사에서는 DB 동시성·복구와 일반/보호 HTTP·prepared
worker 사례72개가 통과하고, 선택 Assistant 환경2개는 건너뛰었다. 이후 독립 리뷰의
개인/배포 권한 혼동을 새 사례로 재현해 수정했고 일반 HTTP 전체6개가 통과했다.
두 suite에는 중복 사례가 있으므로 개수를 합산하지 않는다. 운영 DB나 실제 모델은
사용하지 않았다. Track adapter 관련10개 및 타입 검사도 통과했고, 전체 Track
회귀 검사는1,035개 중1,026개 통과·기존 POSIX 전용9개 skip·실패0개로 종료됐다.

[검증 근거](native-run-commands-verification.json)와
[원본 패치 출처](../integrations/demian-run-commands/provenance.json)를 따른다.
패치는 기존 Native9f45e6c를 기준으로 하며 임시 Git index 적용 결과가 대상 tree와
일치함을 확인했다. 기존 evidence 후보는9f45e6c 기준이므로 새 명령 코드가 포함된
후보라고 표시하지 않는다.

AT-09의 남은 범위는 Assistant WorkCoordinator가 실패 역할의 새 attempt와
후속 Run reference를 소유하는 제어 경로, Track의 현재 권한·capability 연결,
receipt 재시작 복구·Flow 이동·사용자 화면과 실제 제공자 실행이다. native Run만
생성하고 coordinator가 과거 Run을 계속 읽게 해서는 안 된다. 명령 접수, 실행
성공, Projects 업무 수용은 별도 상태다. 전체 수용률은15/21·71.4%(상위 동일
가중치·부분0)이며 개발 작업량 비율은 아니다. 전체 ETA는 산정 불가·신뢰도 낮음이다.
