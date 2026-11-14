# Assistant 예외 배포와 운영 복구

최종 확인: 2026-11-14 16:42 KST. 사용자의 “예외배포는 승인할게. 로그인은 다시 띄워줘”에 따라 검토된 후보를 배포했으나, 실제 Track 연동 실패로 이전 이미지를 복구했다. 전체 배포 성공으로 판정하지 않는다.

## 실행과 결과

| 단계 | 결과 | 증거 범위 |
| --- | --- | --- |
| 예외 승인 | 승인됨 | Persona `32176e985b38317b4d39fcaf558393045f964232` / image `sha256:320474cdd35c1cb7042ff89d61000a7f8d623612f345da1762b57bc1c77ce9f9`; producer CI 성공으로 대체하지 않음 |
| 실제 배포 | 실행됨 | 후보 container `594d6996a71452e91cd66a41f9b5c2f262073abf8e1ef05a8b19fa9c75eae0a3`, PID 1333839 |
| 두 운영 DB readback | 통과 | 기존 업무 행과 정해진 시작 변경을 대조; 새 세 테이블은 비어 있음; helper 제거 |
| 보존 검사 | 통과 | 파일 68개, 다른 12개 서비스와 renderer 보존; writer 비활성; 새 모델 실행 0 |
| 실제 Track 연동 | 실패 | 새 attempt별 권한 확인 경로를 사용하는 Native window가 전체 10초 deadline을 넘어서 source가 disconnected로 바뀜 |
| 소비자 병렬화 후보 | 일부 검증 | 동일 attempt 재확인과 최종 Native 읽기를 함께 수행; 두 새 회귀 사례는 수정 전 실패·후 통과. 관련 검사 92통과·1skip 및 typecheck 통과. 실제 새 producer 연결은 여전히 503이므로 운영 반영하지 않음 |
| 이전 이미지 복구 | 통과 | 기존 DB·credential을 복원하지 않고, 검증된 이전 바이너리만 재기동. 새로 추가한 두 guard만 제거하고 이전 ExecStart hash 복원 |
| 복구 후 Track | 통과 범위 제한 | 같은 Run, 기존 8 events, cursor/highWater 8과 원래 Task binding 보존. 상세 evidence는 forbidden이므로 성공으로 계산하지 않음 |

현재 Assistant는 source `9382c9cb5e337bc186a63cdd74f3b6605164401c`, image `sha256:de1b1f1e9c12589d5cad1a0e86cfd862980295528e8ea7f1ffc4c6f0e5ac22b1`, PID 1395329다. 회귀 후보는 중지한 채 보존했다. Track 운영 release `27e00a8a510091dad7a44875eaf6811b1f4c964b`는 변경하지 않았다.

## 원인과 반증

동일 reader credential의 capability·execution·attempt 응답은 200이고 strict schema도 유효했다. 잘못된 credential, proxy 경로 누락, 잘못된 attempt tuple은 관측된 실패 원인이 아니다.

한 실제 측정에서 attempt 목록은 약 1.0초, 현재 역할 metadata는 약 1.4초, attempt 고정 metadata는 약 4.2초였다. attempt 고정 경로는 Native 권한 확인 전후에 원본 Projects Task 접근도 확인한다. 별도 read-only 측정에서 Note 입력은 0개였으며 Assistant의 실제 Projects Task 조회 하나가 약 1.0초였다. 운영 DB 쓰기와 새 모델 호출은 0이었다.

Track은 첫 Native 읽기, 최신 execution·attempt 재확인, 최종 Native 읽기와 Projects 확인을 하나의 10초 budget으로 처리한다. 새 producer의 추가 경계에서 이 조합이 budget을 넘는다. 이후 실제 격리 조회에서는 attempt 목록만 약 2.7초였고, 병렬화 후보도 503이었다. 개별 측정값을 고정 성능 보장이나 단일 서비스 장애의 증거로 확대하지 않는다.

## 다음 수용 검사

단순 timeout 증가는 이 실패의 해결책으로 채택하지 않았다. 다음 변경은 producer와 consumer의 관측 계약에서 중복 원격 확인을 줄이되, 선택한 historical attempt·현재 Assistant/Projects/Note 권한·Native binding/key 철회 검사를 유지해야 한다. 특히 같은 read의 일관성과 철회 시점 검사, 제한된 대기열과 취소, 여러 역할·여러 attempt의 page 경계를 함께 검증해야 한다.

새 계약은 실재 producer와 소비자의 통합 및 지연·권한 철회 회귀를 통과한 뒤 다시 운영 후보로 만든다. 이 문서의 병렬화 수정만으로 재배포하지 않는다. 실제 새 역할 실행이나 모델 재호출로 기존 증거를 덮어쓰지 않는다.

## 로그인과 진척

Chrome에 Track 로그인 화면을 다시 열고 계정 식별자를 입력했으나, 이후 Chrome이 종료되어 비밀번호/MFA 완료를 확인하지 못했다. Edge에 재개할지 사용자 선택을 요청했다. 인증된 운영 GUI 검증은 미완료다.

전체 수용률은 **15/21·71.4%**(상위 요구 동일 가중치, 부분 충족 0)로 유지한다. 남은 요구는 AT-06·09·12·14·15·20이다. 전체 완료 예상은 미산정, 신뢰도 낮음이다. 새 관측 계약의 실제 통합과 로그인 후 같은 업무의 GUI 검증을 확보한 뒤 재산정한다.
