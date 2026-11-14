# Assistant 조정자 명령 연동

## 현재 범위

보호된 Demian Run의 재시도·재개는 해당 Run을 소유한 Assistant 조정자가
새 역할 시도를 저장하도록 요청해야 한다. Track 읽기 credential은 이 권한을
갖지 않는다. 일반 Native의 `runCommandUsers`와 별개의 명령 경로다.

이 단계는 전용 writer 계약·HTTP adapter·설정 검증을 구현한다. API의 영속
검토/확인/복구와 화면 연결은 후속 단계이며, 현재 운영에 writer를 활성화한
것은 아니다. 기존 보호 Run 명령 화면은 계속 미지원 상태를 표시한다.

## 명시적 설정

Assistant v2 source에 다음 세 항목을 함께 지정해야 한다.

- `assistantCommandCredentialFile`: 전용 writer credential의 절대 경로
- `assistantCommandPrincipalId`: reader와 다른 writer principal
- `assistantCommandUsers`: 현재 단일 소유자 한 명

현재 proxy 인증의 단일 소유자, Assistant reader의 고정 사용자·불변 owner,
Projects source와 명시적 Demian producer mapping이 모두 필요하다. writer
설정은 기존 reader source의 영속 식별자를 변경하지 않는다.

로컬 writer credential은 version 1, audience `agent-track-command`, sourceId,
user, ownerId, principalId, 양의 revision, notBefore, expiresAt, nativeOrigin,
별도 secretFile을 갖는다. 실제 값과 파일은 Git·브라우저에 포함하지 않는다.
reader credential과 proxy key의 경로·실제 key 값도 별개여야 한다.

## 원본 계약

전용 경로는 `/api/integrations/track-command/v1`이다. 요청은 별도 Bearer와
`X-Agent-Track-User`만으로 기계 principal을 확인한다. Entra email만으로
Persona의 owner가 결정되지는 않으며, 원본 grant가 불변 `sso-sub:` owner와
명시적 execution/project scope를 연결한다. UI cookie·proxy identity는
전달하지 않는다.

1. `GET /capabilities`에서 audience·owner·principal·사용자·grant revision을
   로컬 credential과 대조한다.
2. `POST /executions/:executionId/roles/:roleId/commands`에 같은 operationId,
   retry/resume, 검토한 execution revision과 deadline을 보낸다.
3. 응답이 유실되면 같은 경로의 `GET /:operationId`로만 결과를 복구한다.
   adapter는 POST를 자동 재전송하거나 새 operationId를 생성하지 않는다.

202 응답의 `intentState: saved`는 **조정자 요청 저장**이다. Demian 접수,
새 Run 관측, 실행 성공, Projects 수용 완료는 각각 별도로 확인해야 한다.
현재 역할의 Run·시도와 선택한 Run을 대조하는 검토 단계도 필요하므로,
보관된 과거 Run에 이 adapter만 직접 연결해서는 안 된다.

## 오류와 검증 경계

`AssistantCommandError.disposition`의 `withheld`는 해당 호출에서 POST를
시작하지 않았다는 뜻이다. POST 전송을 시작한 뒤의 오류는 `ambiguous`로
남긴다. credential 검사를 끝낸 다음 fetch 직전에 동기 callback으로 현재
Track 계정·source·검토 deadline을 확인할 수 있다. callback 실패도
`withheld`이며, 이후 재전송 허용 여부는 영속 명령 broker가 판단해야 한다.

고정 origin, redirect 금지, bounded JSON/stream/file, credential 회전,
기한과 receipt의 정확한 실행·역할·operationId·kind를 검증한다. 실제
localhost HTTP 검사와 합성 transport의 오류 검사는 운영 원본 연동·실제
모델 실행·사용자 화면 수용을 대신하지 않는다.
