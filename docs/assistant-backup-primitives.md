# Assistant 배포 전 SQLite 복구 검증 도구

`packages/assistant-read/backup.ts`는 Linux의 별도 검증 프로세스에서 실행하는
도구다. 앱의 시작 경로나 요청 처리에 연결하지 않았다. Node24 내장 모듈만
사용하며 native TypeScript stripping으로 실행할 수 있다. Windows에서는
POSIX 소유권·권한 검증을 대체하지 않고 `UNSUPPORTED`로 거부한다.

| 함수 | 동작 |
| --- | --- |
| `measureDatabase` | 읽기 트랜잭션에서 schema와 모든 table/shadow table의 typed row hash·중복 개수·무결성을 측정 |
| `snapshotDatabase` | 페이지 수를 고정한 읽기 트랜잭션에서 native backup 한 번 호출 후 새 복사본의 전체 측정값·파일 hash 대조 |
| `sha256File` | 크기를 제한한 스트리밍 파일 hash |
| `sealSnapshot` | gzip→AES-256-GCM 스트림, 별도 metadata envelope 반환 |
| `restoreSealedSnapshot` | 새 전용 파일로만 복호화하고 인증 tag·압축 해제 크기·파일 hash·SQLite 측정값 대조 |

원본 DB는 `readOnly`와 `query_only`로 열고, 경로의 symlink·hardlink·소유권·
직접 상위 폴더의 공개 권한을 검사한다. 출력은 기존 파일을 덮어쓰지 않는
`wx`/0600 파일이다. 운영 실행 시 원본 volume도 읽기 전용으로 mount해야 한다.
원본 credential·앱 실행 환경·외부 네트워크는 필요하지 않다.

DB는 최대8GiB, table별500만 row, row payload32MiB다. `dbstat`와 SQL의
payload 크기 사전 검사를 통과한 뒤 본문을 읽는다. 현재 row의 본문과 table별
고정 길이 row hash만 유지하며, 전체 DB·전체 table 본문을 메모리에 올리지
않는다. Table 이름은 UTF-8 1,024byte, envelope는 보수적인4MiB 한도다.
해시 수와 SQLite cache를 포함한 별도 프로세스 메모리 한도도 설정해야 한다.

GCM의 인증 대상에는 용도·버전·작업 nonce·DB 종류·평문 크기/hash·측정값
hash가 포함된다. Envelope에는 암호 키와 행 본문을 넣지 않는다. 키 보관·배포,
운영 서비스 상태 확인, 보호 대상 서비스 대조와 code-only rollback은 이
도구를 호출하는 운영 절차의 책임이다. 실패한 복사본은 진단·격리 대상으로
남을 수 있다. 운영 DB 경로를 복원 대상으로 지정하는 자동화는 만들지 않는다.

SQLite 호출 사이와 backup progress에서 deadline을 확인한다. 동기 SQLite
호출 하나를 강제 중단하는 기능은 없으므로 운영 호출자는 별도 프로세스의
전체 실행 시간·CPU·메모리·디스크를 제한하고, timeout 시 그 검증 프로세스만
종료해야 한다. 기존 운영 앱의 프로세스와 메모리를 사용하지 않는다.

검증은 typed int64/float/blob/null/Unicode, 순서와 중복, FTS shadow table,
기존 파일·link·공개 폴더 거부, payload/row/byte 한도, 암호·tag·metadata 변조,
복호화 후 전체 측정값, 다단계 backup과 동시 WAL writer를 다룬다. Linux에서
잘못된 키의 오류 처리 중 발견한 descriptor 중복 종료는 스트림용 descriptor를
별도 생성해 수정했다. 회귀 검사는 같은 실패 조건을 유지한다.

이 검증은 fixture 및 도구 검증이다. 실제 운영 snapshot 생성·복구 훈련,
배포 guard 갱신이나 native reader 활성화의 완료 증거로 대신하지 않는다.
