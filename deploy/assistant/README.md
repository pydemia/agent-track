# Assistant native runtime 전환

`native_clone.py`는 현재 Docker inspect와 명시한 native runtime 추가 설정을
대조하는 순수 함수다. 기존 환경·HostConfig·mount·network 요청을 유지하며
native 환경 항목 3개와 읽기 전용 metadata volume 1개만 추가한다. signing key와
bearer는 host loader와 같은 형식으로 검증한다. 반환 request에는 credential이
있으므로 출력·커밋하지 않는다.

`native_lifecycle.py`는 별도로 준비된 정확한 candidate의 전환과 boot adoption을
수행한다. container·volume·network·credential 생성, DB 복원, 구버전 자동 복귀
기능은 없다. 실제 서비스의 현재 상태로 작성한 private plan과 그 SHA-256을
사용한다. 이전 배포의 plan/receipt를 이 작업에 재사용하지 않는다.

Candidate만 동결 Docker primitive의 `candidate_contract`를 사용해
`OomKillDisable=false/null`의 같은 의미를 정규화한다. 실제 daemon은 생성 때
false, 기동 후 null을 반환했다. 다른 HostConfig 필드와 원본·다른 역할의
계약은 정규화하지 않는다. Plan에도 해당 candidate contract kind를 명시한다.

전환 전제는 현재 candidate/source/state에 대응하는 암호화 백업·복원 검사,
전체 앱의 복원본 기동·정확한 schema/행 대조, 최신 idle baseline이다. 이 증거를
생성하는 integration owner가 신뢰 경계이며, operator는 지정한 evidence 파일의
hash·상태·candidate/source/state 식별자를 다시 대조한다. 합성 unit test는 이
실제 운영 증거를 대신하지 않는다.

모델 실행과 Projects 결과 첨부가 끝났고 Note layout 충돌로만 멈춘 업무는
private plan의 선택 항목 `quiescentPublications`로 정확히 한 건을 지정할 수
있다. 최초 baseline과 중지 직전 조회에서 owner hash·Execution ID·전체 실행 행
hash·Note operation ID·전체 발행 행 hash가 모두 같아야 한다. 실행·취소·재개 요청,
미완료 역할, 미저장 Projects operation, 발행 step·receipt·runner가 있으면 거절한다.
대기 업무를 완료 처리하거나 원장을 수정하지 않는다. 이 항목을 생략하면 기존의
모든 미완료 업무 0건 조건을 그대로 적용한다.

- `inspect`: 기존 13개 component의 process와 raw 설정·network, 원본/candidate,
  renderer/boot role 계약, Docker에서 보이는 state writer와 보존 파일 확인
- `cutover --execute`: 양쪽 실제 guard·대기 start job·15분 이내 baseline·현재
  idle 상태 확인 후 원본 앱만 중지, 보존 이름으로 이동, candidate 이름 전환
- `renderer-resume --execute`: 현재 renderer를 확인하고 중지됐을 때만 시작.
  HTTP listener를 제한된 GET으로 확인하며 렌더링 작업을 발생시키지 않음
- `resume --execute`: renderer → budget → avatar → candidate 순서로 확인/시작.
  이미 실행 중이면 process를 보존하고, 단계별 probe와 candidate 직전 writer를
  재검사. 기존 `ExecStop`과 restart policy를 유지

기존 drop-in과 renderer unit fragment는 보존하고 새 drop-in은 `ExecStart`만
대체한다. 파일 내용과 systemd가 실제 로드한 executable/argv를 함께 대조한다.
실패하면 현재 상태와 증거를 보존한다. 중간 전환 실패를 관찰 timeout만으로
재실행하지 않으며 실제 container 이름/상태와 phase journal로 확인한다.

Marker는 Linux에서 임시 파일 fsync → no-overwrite hard link → 부모 directory
fsync로 게시한다. Docker 상태와 파일 게시는 하나의 transaction이 아니므로
호출자는 전환 시작/종료와 부분 실패를 별도 기록해야 한다. state writer 검사는
두 Docker engine에서 보이는 mount 접근에 한정되며 일반 host process 격리를
보증하지 않는다.

검사:

```text
python -m unittest discover -s tests -p 'assistant_native_*_test.py'
```

운영 현황은 [수용 기준표](../../docs/goal-status.md)와 현재 검증 기록을 따른다.
원격 후보 앱 기동, image 배포, native Run 위임, 전체 WorkCoordinator/Projects/
Note/desktop/Track 업무 수용은 서로 구별한다.
