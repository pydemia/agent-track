# 보호된 Demian 실행 metadata

`c439341`의 전용 실행 API 이후 `db861e8`의4개 파일만 전달한다.
`provenance.json`의 baseline·tree·파일 hash와 일치하는 별도 checkout에서
`git apply --check --unidiff-zero native.patch`로 확인하고 같은 옵션으로 적용한다.
독립 Git index에 적용한 tree가 target commit과 정확히 일치했다.

서명 GET `/api/v1/runs/:runId/metadata?after=0&limit=100`은 기존 원본
context/request/correlation receipt와 현재 binding·역할·키·정책·prepared authority를
검사한다. 일반 bearer나 legacy API의 보호 Run 차단을 유지한다. SQL의 양성
projection으로 이벤트 ID·상태·도구명·경로·versioned flow만 읽으며 입력/출력·
도구 인수·artifact bytes는 반환하지 않는다. int64 cursor와 한도/byte budget을
검사하고 직렬화 후에도 현재 인가를 대조한다. 새 migration과 credential은 없다.

임시 PostgreSQL의 metadata·기존 signed runtime 회귀44개가 통과했다(skip0).
실제 SQL 결과를 Persona portable schema로 대조했고, API 타입 검사와 bundle
build도 통과했다. 임시 DB container/network는 소유권 확인 후 제거했다.
원본 운영 DB·API·worker는 변경하지 않았다. 이 source commit은 upstream 병합이나
운영 반영을 의미하지 않는다. 다음은 API release·공개 gate 경로·Assistant reader·
Track source를 함께 확인하는 운영 단계다.

[전체 연결과 검증 한계](../../docs/assistant-native-observation.md)를 따른다.
