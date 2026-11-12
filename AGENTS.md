# Agent Track 작업 경계

- 이 Windows checkout의 `dist/web`는 현재 운영 Track이 읽는 경로다.
  로컬 확인에는 `npm run build:check`를 사용한다. 배포 후보는
  `npm run build -- --outDir ../../.runtime/<고유 작업>/web`로 별도 생성한다.
  기본 `npm run build`는 이 checkout의 운영 정적 파일을 교체하므로 실행하지 않는다.
- 운영 반영은 현재 산출물·설정·프로세스와 backup을 확인한 뒤 별도 단계에서 수행한다.
  새 API가 필요한 프런트엔드를 먼저 운영 경로에 게시하지 않는다.
- 운영 AgentTrail과 원본 Demian DB·runtime·인증은 요청 범위 밖에서 변경하지 않는다.
  실제 연동·합성 fixture·코드 검사와 운영 검증을 구별한다.
