# 업무 흐름 개선 시안 R1

기획서는 [workflow-reading-v2.md](../workflow-reading-v2.md)다. 현재 Track의 `FlowCanvas`를 실제로 import하고 나머지 화면은 검토용 React/HTML로 구성했다. 대화 문구는 실제 검증 사례를 바탕으로 재구성한 예시이며 운영 데이터를 조회하지 않는다.

`preview.tsx`·`preview.css`·`index.html`은 시안 소스다. index.html을 직접 여는 대신 bundle을 생성한 결과를 연다. 현재 작업의 builder는 저장소 루트에서 실행한다.

```text
node docs/proposals/workflow-reading-v2/build.mjs
```

결과: `.runtime/flow-reading-v2/preview/index.html`. JS는 IIFE로 bundle되어 해당 로컬 HTML을 열어 조작할 수 있다. 생성 산출물과 캡처·검증 기록은 `.runtime/flow-reading-v2`에 있다. 이 빌드는 운영의 `dist/web`를 변경하지 않는다.

조작: 검토 사례 선택 → Track/Trail/Trace/Map → node 또는 하단 작업 선택 → 요약/대화/도구/근거. `묶음 내부 보기`, `묶음 접기/펼치기`, `전체 업무`, `현재 범위 맞춤`, `기술 근거`를 확인할 수 있다. 변경은 페이지의 메모리 상태에만 적용되며 새로고침하면 초기화된다. 저장·Run 실행·배포 기능은 없다.

FlowCanvas 및 @xyflow/react의 기존 라이선스·고지를 따른다. pydemia UI의 다른 컴포넌트는 source를 편입하지 않았고 UI 형태·행동을 native 요소로 모사했다. 공개 registry와 로컬 provenance의 근거는 기획서에 구분했다.
