# Assistant용 Demian 실행 경계

기존 일반 API8080의 조회를 유지하면서 별도 API8081에서 bearer·HMAC·현재
binding/역할/nonce를 확인한다. 같은 trusted DB principal을 사용하므로 DB 신원
분리로 표현하지 않는다. 공개 `demian.pydemia.ai`는 필요한 서명 경로만 전용
API로 보내며, 기존 브라우저 인증과 웹3001은 유지한다.

## 소스와 적용 범위

`native.patch`는 배포 전용 worker 경계 `c5284e3` 이후 `c439341`까지의18개
파일 변경이다. [provenance.json](provenance.json)의 baseline/payload hash와
일치하는 별도 checkout에서만 `git apply --check native.patch`를 사용한다.
독립 Git index에 적용한 전체 tree가 target commit과 정확히 일치했다.
광범위한 원본 WIP를 통째로 채택하거나 upstream 병합한 패치가 아니다.

- 전용 API entry에서 일반 peer·deployment selector와 mount/CORS를 켜지 않는다.
- 위임 취소의 현재 권한 검사와 Run 변경을 같은 transaction에서 수행한다.
  COMMIT 결과 유실이나 commit 뒤 event 실패를 단순 rollback 성공으로 표시하지 않는다.
- prepared 실행은 실제 역할의 설명용 toolScope를 문맥으로 보존한다. native 도구와
  권한은 비워 두고 기본 deny/read-only를 적용하며, 일반 위임의 범위를 확장하지 않는다.
- 신규 실행은 fresh `delegated_prepared_role_metadata_v1` worker를 요구한다.
  worker 중지 후의 기존 완료 이력 조회/허용된 취소에는 liveness를 덧붙이지 않는다.
- migration026은 함수·trigger만 추가한다. 운영에서는 기존 전체 migration을
  재실행하지 않고, 최신 백업 복원본에서 검증한 정확한026만 적용했다.

관련 격리 PostgreSQL 검사123개와 core provider29개를 통과했다. 격리 검사와
통제된 provider fixture를 실제 운영 모델 호출로 세지 않는다. 별도 source review에서
검토 범위의 추가 blocker는 발견하지 못했으며 동적 운영 검증과 구분한다.

## 현재 운영과 남은 업무

2026-11-13 전용 API/worker와 공개 gate를 운영 연결했다. 동결 패키지19,622개
파일·5개 link를 확인했고, 별도의 운영 manifest로 실행한다. 원래24시간짜리 QA
manifest를 무기한 운영 증거로 바꾸지 않았다. 소스 checkout 없이 실행 가능한
동결 시작 도구의 기존 process 식별도 확인했다. 자동 시작은 아직 구성하지 않았다.

Windows worker의 `requireIsolation=false`는 명시적 구성이다. prepared 경로의
무도구/read-only 제한을 일반 OS sandbox 보장으로 확대하지 않는다.

실제 Assistant 후보 이미지의 compiled host loader/gateway로 Linux→공개 HTTPS→
현재 native API의 capability·actor·bound Session을 모두200으로 확인했다.
이 probe는 credential/운영 DB mount 없이 별도 container와 메모리 DB에서 실행했다.
운영 Assistant 전환, WorkCoordinator 실행, 결과/Note 연결, protected Run metadata의
Track 인가 연결과 desktop의 전체 업무는 여전히 남는다. 새 운영 Task/Note/Run·
모델 호출을 이 단계에서 생성하지 않았다.

[운영 근거와 검증 한계](../../docs/demian-dedicated-service-verification.json)를 따른다.
