# Agent Track 운영 복구와 진척 정체 원인

2026년 11월 16일, 승인된 Persona source `4a9ad42` / 이미지 `b68ece66`을 운영 Assistant에 반영했고 Edge의 Entra 로그인을 확인했다. Persona CI는 결제·한도 문제로 검사 시작 전 실패 상태이며, 사용자가 지정한 이미지의 예외 승인을 적용했다. CI 통과로 기록하지 않았다.

## 현재 확인한 결과

| 범위 | 확인 결과 |
|---|---|
| Persona 운영 | 승인 이미지 기동, 이전 이미지 중지 보존, writer 비활성 |
| 원본 데이터 | Work 33개·Runtime 65개 테이블 대조, 보고 pin·시작 payload 6개 보존 |
| 설정·다른 서비스 | 선택 설정 68개와 다른 서비스 12개·renderer 보존 |
| 실제 기존 Run | 이벤트 8개와 당시 Task binding r3 보존, 새 Run·모델 요청 없음 |
| Track 운영 | API·web `186ff8d` 전환 완료, SQLite 무결성·이력 보존 |
| Track 사후 검사 | 정적 파일 18개, 설정 47개·다른 프로세스 18개 보존, 익명·위조 인증 거부 |
| 실제 Task 저장 보기 | 생성·조회·이전 revision 충돌 409·자기 probe 제거·제거 후 조회 통과 |
| 현재 화면 수용 | 그룹·연결선·상세 8개 이벤트 관측 후 재확인에서 다시 누락, AT-14 미완료 |

실제 업무는 Execution `f8a9e44f` / Task `e4470864` / Run `60cca68d`를 재사용한다. Task는 **r5 / in_review**다. Run 성공과 Projects의 업무 수용은 구별하며 Task를 완료로 변경하지 않았다.

초기 Persona 전환 후 실제 Trace에서 선택 모델 `gpt-6.1-sol`, 이벤트 8개, 구간별 시간, 범위별 사용량, 산출물 1개와 lineage 연결선을 확인했다. 당시 화면은 4 nodes·3 edges·3 groups였고 연결선을 선택하면 원본 seq 4·5가 나타났다. 이후 전체 업무 화면의 경합이 발견됐으므로 이 과거 화면만으로 현재 통합 수용을 완료 처리하지 않는다. 사용량 관측 4건은 서로 다른 범위를 포함하며 범위별 마지막 보고를 합산하지 않는다.

## 진척 수치가 오래 바뀌지 않은 이유

실제 업무의 Projects 결과·Note 발행·참조와 성공 Run까지는 연결돼 있었지만, 보호된 상세 reader의 운영 전환과 인증 화면 수용이 남았다. 승인된 이미지를 배포한 뒤 실제 통합 화면을 확인하면서 추가 결함을 발견했다.

첫째, 현재 Runtime 사본 5.2GB의 독립 복원 검증이 기본 300초 예산에 도달했다. 운영 전환 전에 중단했고 원본 DB를 복원하지 않았다. 기본 제한과 암호·행 검증은 유지하고 명시적인 유한 검증 예산 전달을 보완해 확보한 현재 사본을 재검증했다. 실패한 최초 작업의 plaintext 사본은 격리 보존 중이다. 후속 암호화 복구 volume은 암호문과 envelope만 남았음을 별도로 확인했다.

둘째, Task 전용 저장 보기와 Task 조회가 무관한 Native 수집까지 기다렸다. 첫 두 Track 전환은 최종 owner probe의 503 또는 deadline으로 실패해 이전 API로 자동 복구됐다. DB 복원 없이 설정·원장·다른 서비스 보존을 확인했다. Task 경로를 Projects 권한 확인으로 한정한 뒤 실제 저장 보기 probe와 운영 전환이 통과했다. Run·Assistant를 함께 고정한 혼합 저장 보기의 수용은 별도다.

셋째, 자동 수집 중 Native grant를 비우는 순간을 Assistant 상세·snapshot·SSE가 읽을 수 있었다. 조회와 수집을 조정한 `9898092`의 사후 검사에서는 이벤트 8개와 상세 근거가 정상 조회됐지만 후속 상세 요청은 404를 반환했고, 실제 브라우저에서도 연결 끊김이 발생했다. 간헐 실패를 통과로 처리하지 않았다.

추가 분석에서 SSE가 첫 frame 전에 원본 수집을 두 번 수행하고, 새 수집이 이미 대기 중인 화면 조회를 앞지를 수 있음을 확인했다. source별 대기 순서를 보장하고 초기 SSE 중복 수집을 제거한 후보를 준비했다. 기존 권한·철회 검사, 10초 authority 예산과 15초 metadata lease는 유지한다. 새 회귀 사례 2개는 이전 코드에서 모두 실패했고 수정 후 관련 45개가 통과했다. 전체 로컬 검사 1,258개 중 1,247개 통과·실패 0·기존 환경별 제외 11개다.

후보 `173232a`의 Windows CI는 통과했지만 Ubuntu의 기존 context timeout 테스트가 고정 대기 후 취소 여부를 관측하는 방식 때문에 실패했다. 20ms deadline은 그대로 두고 fetch 진입→deadline→늦은 응답 해제→body 취소 순서를 직접 검증하도록 고쳤다. 관련 7개와 typecheck가 통과했다. 후보 `7cc029c`의 Windows·Ubuntu CI와 운영 전환이 통과했다. 최초 사후 snapshot에서는 보호 Run이 누락됐으나 후속 연결 상태·이벤트 8개·상세 근거·보존 검사가 통과했다. 최초 실패 원인이 완전히 해소됐다고 기록하지 않는다.

인증 화면에서 Execution r72·Task r5·실제 실행 연결 1개와 6 nodes·6 edges·4 groups를 확인하고 Assistant 실행 그룹 내부로 들어갔다. 이후 다른 Demian snapshot 변화가 Assistant 전체 조회 scope를 초기화해 선택과 그룹이 사라지는 문제를 추가로 재현했다. 전체 Assistant 목록의 권한 범위에서 무관한 Run 변화를 분리하고 상세 component의 식별자를 실행 단위로 유지하는 `6011ab5`를 준비했다. 목록과 상세 중 어느 한쪽이 거부한 연결은 교집합 검사로 즉시 숨긴다. 기존 현재 snapshot의 Run·출처·Projects 확인도 유지한다. 관련 30개와 typecheck·독립 재검토를 통과했고, 마지막 보완 전 전체 1,261개 중 1,250개 통과·실패 0·기존 환경별 제외 11개다. `6011ab5`의 Windows·Ubuntu CI와 운영 반영을 완료했다. 현재 화면에서는 Native 연결이 없을 때도 업무·역할을 유지하고, 연결 복구 후에도 같은 그룹 경로를 유지했다. Track→Map 이동과 원본 관계 inspector에서 Run·Session·Operation 근거를 확인했다.

이어 Trace 진입 시 상세 API의 403/404를 로그인 만료처럼 취급해 전체 대시보드를 지우고 SSE까지 닫는 결함을 재현했다. 전체 초기화는 401에만 적용하고, 403/404는 해당 Run의 상세 근거만 지운 뒤 기존 15초 재확인을 유지하도록 `186ff8d`에서 수정했다. 권한 없는 상세 근거를 유지하지 않는다. 관련 검사 23개와 타입·별도 빌드, Windows·Ubuntu CI가 통과했다. 현재 사본 검증과 운영 전환을 완료했다. 정적 파일 18개·설정 47개·다른 프로세스 18개와 이력 보존 검사는 통과했다. 별도 사후 API 검사는 snapshot 성공 뒤 events 404로 실패했으며, 이 실패를 보존 검사 통과로 덮지 않았다.

마지막 Edge 검사에서는 새 module `/assets/index-XU3b7uEe.js`와 LIVE 대시보드를 확인했다. 상세 접근 거부 후 전체 화면과 SSE가 유지됐고, 재확인 및 이벤트 재조회 후 정규 이벤트 8개·Native 이벤트 8개·선택 모델·사용량·산출물 1개가 나타났다. Native Run 그룹 안으로 들어가 연결선을 선택했을 때 source와 seq 4·5가 inspector에 표시됐다. 그러나 다음 원본 재확인에서 상세 이벤트와 연결선이 다시 숨겨졌다. 마지막 캡처는 같은 Run의 1 node·0 edge 상태이며, 안정적인 반복 조회를 완료했다고 주장하지 않는다.

따라서 현재 남은 직접 문제는 원본 metadata/evidence 재확인의 간헐 404/503이다. queue·lease·원격 읽기 경계 중 실제 실패 지점은 아직 특정하지 못했다. 대기열과 만료가 실패를 유발할 수 있다는 코드 검토와 실제 실패 경계를 구분하며, 권한 검사나 deadline을 완화해 완료 처리하지 않는다. 다음 작업은 실제 단일 운영 reader와 브라우저 부하에서 경계별 지연을 계측하고 같은 업무의 반복 조회를 수용하는 것이다.

## 수용 기준과 남은 범위

**상위 수용 15/21·71.4%를 유지한다.** 동일 가중치·부분 0인 기존 판정이며 전체 개발 완료율이나 남은 시간 비율이 아니다. AT-14 안에서 구현·운영 검사 결과가 늘었어도 같은 실제 업무의 인증 화면 수용이 남아 상위 개수는 증가하지 않았다.

| 영역 | 현재 상태 |
|---|---|
| 운영 reader | 🟩 승인 이미지·reader 운영 반영 및 데이터 보존 확인 |
| Trace 반복 가용성 | 🟨 8개 상세·연결선 관측 후 자동 재확인에서 다시 누락 |
| 통합 업무·역할·실행 연결 | 🟨 현재 GUI 수용 미완료 |
| 명령·복구 | 🟨 부분, writer 비활성 |
| 그룹·저장 보기 | 🟨 부분, 혼합 scope·peer 실기 남음 |
| 다중 장치·원본 앱 이동 | 🟨 부분, 실제 다중 장치·원본 문맥 수용 남음 |

남은 상위 요구는 AT-06/09/12/14/15/20이다. 전체 필수 하위 결과의 분모는 아직 확정되지 않아 별도 표시 진행률을 만들지 않았다. 전체 완료 ETA는 산정 불가이며 신뢰도는 낮다. 외부 조건은 writer 활성화 범위, 원본 앱 인증과 실제 다중 장치 검증이다. 다음 재산정은 같은 실제 업무의 반복 조회·그룹·Trace가 유지되는 운영 수용 후다.

별도 읽기 전용 DB 검사는 하나의 원자적 cross-database transaction이 아니다. 별도 reader를 운영 수집기와 함께 띄운 canary는 deadline 또는 연결 실패로 통과하지 않았다. 원격 동시 처리 용량의 원인이나 해결을 확인한 것으로 기록하지 않는다.

최종 관측과 실패는 [11월 16일 운영·화면 기록](https://github.com/pydemia/agent-track/blob/main/docs/assistant-workflow-observation-20261116.json)에 함께 보존했다. Track 최종 [CI](https://github.com/pydemia/agent-track/actions/runs/43814636082)는 두 플랫폼 모두 통과했다.

근거: [전체 수용표](https://github.com/pydemia/agent-track/blob/main/docs/goal-status.md), [실제 업무 기록](https://github.com/pydemia/agent-track/blob/main/docs/workflow-observation-2026-11-14.json), [Persona 운영 검증](https://github.com/pydemia/agent-track/blob/main/docs/assistant-reader-promotion-operating.json), [동시 조회·전환 기록](https://github.com/pydemia/agent-track/blob/main/docs/assistant-link-coordination.json).
