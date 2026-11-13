# Projects의 실행 결과·Note 참조 연결

Assistant의 실제 업무 실행은 Note 게시 전에 Projects 결과를 연결하고, 게시 후
같은 결과에 Note 참조를 추가한다. 운영 서비스는 이 계약을 지원하지 않는다.
기존 `projects-before-note` 후보를 재사용하되 현재 운영 의존관계 API를 보존하고,
반복 결과 게시 때 이전 Note 참조가 사라지는 문제를 수정한 변경이다.

`native.patch`는 `resultsBeforeNote`·`resultNoteReferences`, runtime-only 결과와
`POST /tasks/{task}/results/{result}/note-reference`를 제공한다. 기존 principal과
`results:attach`·현재 Project/Task ACL, 원 결과 binding, CAS, idempotent receipt를
유지한다. runtime-only 결과는 canonical Assistant execution URL과 `in_review`를
요구하며 실행 종료를 Task 수용으로 바꾸지 않는다. Note 참조는 검증되지 않은
metadata다. Note의 본문·권한을 Projects가 검증했다는 뜻이 아니다.

이전 publication은 `assistant_note_reference_history`에 최대100건 보존한다.
한도 초과는 기존 자료를 유지한 채 거부한다. URL·revision·content hash가 다른
버전은 별도 참조로 표시하고, 기존 수동 참조와 원 operation receipt를 보존한다.
현재 Task JSON의 확장이며 PostgreSQL schema migration이나 새 권한은 없다.

## 고정된 입력으로 패키징

[provenance.json](provenance.json)은 운영 이미지와 원본4모듈, 보존할 의존관계
모듈의 hash를 고정한다. 변경4모듈만 배포 payload에 포함한다. 원본은 Docker
GET archive로 읽었으며 공유 Projects 작업 트리를 수정하지 않았다.

```powershell
python scripts/package-projects-results.py --variant candidate --output .runtime/projects-results/candidate
python scripts/package-projects-results.py --variant compatibility --output .runtime/projects-results/compatibility
```

기본 baseline은 전용 QA 작업 폴더의 `operating-modules`다. 새 작업 환경에서는
동일한 운영 이미지의 다섯 모듈을 별도 폴더로 읽고 `--baseline`으로 전달한다.
hash 불일치·기존 output·적용 결과 불일치는 거부한다. 패키징은 서비스 전환이 아니다.
Patch는 zero-context 형식이며 적용 전4모듈 전체 hash와 적용 후 전체 hash를
대조한다. 기존 운영 의존관계 모듈도 별도로 고정한다.

## 데이터가 생성된 후의 복귀

신규 Task JSON과 `note_reference` 영수증은 구 binary가 모두 읽을 수 없다.
`compatibility.patch`는 구 mutation API·미지원 capability 상태를 유지하면서
새 metadata와 영수증을 읽는 복귀용 변경이다. 과거 DB·credential·authority를
복원하거나, 새 결과 생성 후 원래 binary로 곧바로 복귀하지 않는다.

두 패키지 모두 전체 운영 이미지의 cold start·현재 설정/backup·전환과 원격
프로세스 검증은 별도다. 운영 적용이나 실제 교차 앱 업무 수용을 완료한 산출물이
아니다. [현재 검사와 한계](../../docs/projects-results-verification.json)를 따른다.
