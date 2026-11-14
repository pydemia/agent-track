# Native 상세 관측 제공자 운영 전환

2026-11-14에 전용 Native API8081과 공개 서비스 게이트3100을 전환했다.
API source는 `2c113bb34fe120345d9e617524c8d41df2bbd4c6`, PID75264이며
manifest는 `924c187e85328d40a3a1dcc41fca6ff37676706b51e794b1cc0eddaab647c5e4`다.
게이트 PID는3732다. [운영 근거](native-producer-operating.json)를 따른다.

같은 실제 완료 Run `60cca68d-95d1-4d99-963a-c2554e0df347`의 evidence를
임시 API·운영 API·게이트·공개 HTTPS에서 조회했다. 이벤트8개·모델 관측1개·
usage 관측4개·lineage2개·산출물1개를 반환했다. 이는 관측 항목 수이며
새 실행 수나 합산 token 수가 아니다. 기존 capability·actor·Session 조회도200이고,
서명 없는 bearer와 게이트의 비정규 query는403이다. HTTPS 인증서 검증을 유지했다.

## DB 변경과 보존 경계

전용 API는 원본 API와 PostgreSQL11931의 같은 `demian` DB를 사용한다.
실행 중 Run이0임을 확인한 뒤027 migration과 marker를 한 transaction에 적용했다.
원본 DB schema가 변경됐으므로 이를 원본 DB 미변경으로 표현하지 않는다.

사본에서 고정한 전체 catalog 정의와 일치하는 변경만 허용한다. 빈
`run_commands` table, 기존 `runs`의 unique constraint/index, 함수2개와 trigger2개다.
기존45개 table의 행·migration marker·sequence와 기존 role/settings/policy/view/grant를
대조했다. 예외는 새027 marker, 정상 서명 조회의 nonce 추가와 실제 worker의
`checked_at` 전진이다. 새 명령·모델 요청·writer grant는 만들지 않았다.

원본 API8080/PID15940, 전용 worker/PID42184와 해당 설정·자격 증명을 보존했다.
worker source는 여전히c439341이며 최신 worker의 운영 적용으로 확대하지 않는다.
기존 게이트의 브라우저 인증 구성도 보존했다. 이는 Track/Trail의 기본 Entra 인증을
변경한 작업이 아니다.

## 실패 복구

API pointer는 기존 hash가 일치할 때만 교체한다. 복구는 프로세스의 전체 CIM
identity와 loopback port 소유권을 확인한다. 기존 API가 살아 있으면 유지하고,
이 작업의 후보가 확인되면 그 후보만 종료한 뒤 이전 코드로 시작한다.
소유권을 확인할 수 없으면 임의 종료·중복 시작 없이 복구 미확인으로 기록한다.
DB·credential·authority의 과거 사본을 복원하는 경로는 없다.

독립 검토에서 로그 기록 실패가 복구를 막는 경우와 종료 직후 상태 확인 실패가
복구를 건너뛰는 경우를 발견했다. 두 실패 조건과 소유권 불명 사례3개가 수정 전
실패하고 수정 후 통과했다. 보존/복구 관련65개, 기존 게이트/전환 관련61개와 타입
검사가 통과했다. 게이트의 별도 정적 검토에는 구체적 결함 지적이 없었으며,
정적 검토와 실제 운영 조회를 구분한다.

위 보존·복구 source8aec0c0의 CI43554880409는 Windows·Ubuntu 모두13단계
성공으로 종료됐다. 후속 문서와 Assistant 후보 검사는 이 source CI와 구분한다.

## 남은 수용 조건

Track API·웹은27e00a8, Assistant는9382c9c 운영이다. 최신 Assistant32176e9의
이미지는 빌드됐고 실행하지 않은 후보의 기존 환경·마운트·네트워크 일치를 확인했다.
Work DB와 로컬 runtime DB의 실제 사본에서 startup·추가 table·기존 행과 코드 복귀를
확인한 뒤 운영 반영해야 한다. 현재 PC의 Entra 로그인 이후 같은 업무의 상세 Trace와
그룹 탐색을 대조하는 검사도 남는다.

후속 [Assistant 사본 검사](assistant-native-producer-copy.json)는 완료됐다. 실제 Work
45,719,552B·runtime5,203,615,744B를 각각 암호화·복원하고, 같은 사본에서 후보와 이전
운영 버전의 정상 기동을 확인했다. Work의 새 table2개·runtime의 새 table1개는 원본
선언과 일치하고 비어 있다. 두 버전의 시작 처리에 한해 고정된 역사 task3개의 revision과
UI6event를 역산해 기존 행 hash 일치를 확인했다. 임시 container·volume은 제거했고
암호화 backup은 보존했다. 원본의 읽기 전용 baseline과 lifecycle preflight도 통과했지만
새 guard 설치·Assistant 교체는 아직 수행하지 않았다. Persona CI의 실행 전 실패는
이 사본 검사나 Track8aec0c0 CI 성공으로 바꾸어 표시하지 않는다.

Native 전환 뒤 기존 Track 수집도 별도로 확인했다. 같은 보호 Run은connected·succeeded,
cursor=highWater=8이고 기존 이벤트 metadata SHA는dc8f4af8…18f15로 일치한다.
이전 Assistant 경유의 상세 Trace는 여전히steps0이며, 새 Assistant 적용 전의 한계다.

상위 수용은15/21·71.4%(동일 가중치·부분0)다. 이번 제공자 전환만으로 AT-09/14를
완료로 올리지 않는다. 전체 ETA는 산정 불가·신뢰도 낮음이다.
