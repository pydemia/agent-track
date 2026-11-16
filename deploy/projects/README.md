# Projects 서명 조회의 사설 전달기

`read_transport_relay.py`는 동일 Linux 호스트의 기존 Projects edge
`127.0.0.1:14324`에 Task·capability GET만 전달한다. Projects가 기존 HMAC와
현재 ACL을 검사한다. 전달기는 credential·응답을 저장하지 않으며 Cookie나
forwarded 신원 헤더를 전달하지 않는다. 쓰기·query·다른 경로는 거부한다.

Persona 후보의 `PERSONA_PROJECTS_READ_TRANSPORT_ORIGIN`을 명시할 때만
활성화한다. 설정을 생략하면 기존 HTTPS 경로를 사용한다. 다른 조회와 쓰기는
계속 HTTPS를 사용하며 사설 경로 실패 시 공개 주소로 재시도하지 않는다.
Entra 설정·사용자 권한·원본 DB 변경은 필요하지 않다.

운영자가 확인한 RFC1918 IPv4 인터페이스와 전용 port를 지정한다. Docker의
서로 다른 namespace에서 겹치는 subnet에 잘못 연결하지 않도록 실제
Persona 프로세스에서 경로를 확인한다. 공개 listener나 다른 앱의 network
변경은 이 도구의 기능에 포함되지 않는다.

```text
python3 -I read_transport_relay.py --bind <확인한 사설 IPv4> --port <전용 port>
```

전체 원본 읽기 제한은 10초, 응답 상한은 기존 client와 같은 40MiB,
동시 처리 상한은 8개다. 초과 요청은 cache 없이 503을 반환한다.
Task·capability의 유효한 Content-Length를 요구하며 불완전 응답은 성공
본문으로 확정하지 않는다. 상위 Track의 deadline·권한 grant TTL은 변경하지 않는다.

운영 전에는 전달기 소스 hash·listener PID와 시작 시각·인터페이스 소유권,
Persona의 정확한 image·source·환경 변경 한 항목·원래 설정과 process를
동결 계획에 연결한다. 복구는 기존 이미지·환경으로 앱을 전환하고 해당 작업이
소유한 전달기만 중지하는 방식이며 DB·인증 복원은 포함하지 않는다.
이 문서와 단위 검사 통과는 운영 배포를 의미하지 않는다.

```text
python -m unittest discover -s tests -p 'assistant_native_projects_transport_test.py'
```
