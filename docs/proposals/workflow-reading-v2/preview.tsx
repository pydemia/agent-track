import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarkerType } from '@xyflow/react';
import { FlowCanvas, type FlowNode, type FlowEdge } from '../../../apps/web/src/ui/flow-canvas';
import '@xyflow/react/dist/style.css';
import '../../../apps/web/src/ui/flow-canvas.css';
import './preview.css';

type Item = { title: string; owner: string; purpose: string; result: string; evidence: string; kind: string; status?: string };
const items: Record<string, Item> = {
  workspace: { title: '문서 검토 작업공간', owner: 'Demian · 현재 PC', purpose: '안내문 작성을 위한 원본 문서를 제공합니다.', result: '문서 세 개가 실행 범위에 있습니다. Projects 업무 연결은 없습니다.', evidence: '작업공간 소속 · 업무 의존성 아님', kind: '작업공간' },
  session: { title: '사용자 안내 작성 Session', owner: 'Demian · 현재 PC', purpose: '조정 Agent와 하위 Agent의 실행을 묶습니다.', result: '한 업무의 실패와 재시도 기록을 보존합니다.', evidence: '명시된 Session 소속', kind: 'Session' },
  coordinator: { title: '안내 작성 조정 Agent', owner: 'guide-coordinator', purpose: '문서 확인과 하위 검토를 조직하여 안내문을 작성합니다.', result: '하위 검토를 받은 뒤 안내 초안을 종합했습니다.', evidence: '하위 Agent 위임과 반환 · 원본 연결', kind: 'Agent' },
  read: { title: '업무 내용 문서 확인', owner: 'guide-coordinator', purpose: '사용자 안내에 필요한 업무 목적·조회 흐름을 확인합니다.', result: 'inline-work-content.md를 읽었습니다. 구형 본문 reader의 제공 범위가 포함되어 있습니다.', evidence: 'read_file · docs/inline-work-content.md', kind: '도구 호출' },
  review: { title: '대화·실행 시도 검토', owner: 'guide-doc-reader', purpose: '대화 수집 범위와 이전 실행 시도를 구분하는 방법을 검토합니다.', result: '문서 두 개를 읽고 근거·제약을 반환했습니다. 화면을 직접 검증한 결과는 아닙니다.', evidence: '하위 Agent 1개 · 파일 읽기 2회 · 해당 대화 7항목', kind: 'Agent 업무 묶음' },
  journal: { title: '대화 기록 문서 읽기', owner: 'guide-doc-reader', purpose: '중간 대화·도구 입력·응답의 제공 범위를 확인합니다.', result: 'conversation-journal.md 원문을 읽었습니다.', evidence: 'read_file · docs/conversation-journal.md', kind: '도구 호출' },
  attempts: { title: '이전 실행 시도 문서 읽기', owner: 'guide-doc-reader', purpose: '재시도·재개와 이전 응답의 연결 기준을 확인합니다.', result: 'assistant-attempts.md 원문을 읽었습니다.', evidence: 'read_file · docs/assistant-attempts.md', kind: '도구 호출' },
  summary: { title: '검토 결과 종합', owner: 'guide-coordinator', purpose: '읽은 자료와 하위 Agent 검토로 사용자 안내를 작성합니다.', result: '1,633자 안내문을 작성했습니다. 구형 reader 한도와 새 journal 한도를 구분하는 편집이 필요합니다.', evidence: '최종 응답 원문 · 원본 출력과 일치', kind: '업무 결과' },
  failed: { title: '시도 1 · 실행 실패', owner: 'Assistant · 업무 운영·보고', purpose: '명령 복구 QA 점검 메모를 작성합니다.', result: 'Deployment execution failed or is no longer authorized.', evidence: 'deployment_execution_failed · 원본은 실행 실패와 권한 실패의 세부 사유를 구분하지 않음', kind: '실행 시도', status: '실패' },
  cancelled: { title: '시도 2 · 취소 종료', owner: 'Assistant · 업무 운영·보고', purpose: '같은 QA 업무의 재시도 요청입니다.', result: '취소 종료가 관측됐습니다. 최종 메모 작성 성공으로 표시하지 않습니다.', evidence: '재시도 요청은 coordinator intent · 실행 의도와 결과 구분', kind: '실행 시도', status: '취소' },
  success: { title: '시도 3 · 점검 메모 작성', owner: 'Assistant · 업무 운영·보고', purpose: '실행 접수·취소·재개·복구·결과 확인을 정리합니다.', result: '점검 메모가 작성됐습니다. 실행 기록 검증이나 Projects 업무 수용을 대신하지 않습니다.', evidence: '이전 수집 방식 · 요청/최종 응답만 제공 · 미수집 중간 기록 복원 불가', kind: '실행 시도' },
};
const titles = { demian: 'Track 대화·도구 응답 사용자 안내 작성', assistant: 'Agent Track 명령 복구 QA — 실행 1건' };

function Prototype() {
  const [scenario, setScenario] = useState<'demian' | 'assistant'>('demian');
  const [view, setView] = useState(window.innerWidth <= 650 ? 'Trail' : 'Trace');
  const [depth, setDepth] = useState('업무 흐름');
  const [selected, setSelected] = useState('review');
  const [pane, setPane] = useState('요약');
  const [inside, setInside] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(true);
  const [edge, setEdge] = useState<string | null>(null);
  const [fit, setFit] = useState(0);
  const item = items[selected] ?? items.review;
  const pick = (id: string) => { setSelected(id); setEdge(null); setPane('요약'); };
  const changeScenario = (next: 'demian' | 'assistant') => { setScenario(next); pick(next === 'demian' ? 'review' : 'success'); setInside(false); setCollapsed(false); };
  const enter = () => { setInside(true); setCollapsed(false); pick('journal'); };
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  function node(id: string, x: number, y: number) {
    const a = items[id];
    nodes.push({ id, type: 'pyd-flow-node', position: { x, y }, width: 226, height: 148, style: { width: 226, height: 148 }, selected: !edge && id === selected,
      ariaLabel: a.title, data: { title: a.title, kindLabel: a.kind, description: a.owner,
        kind: id === 'summary' ? 'result' : 'action', status: id === 'failed' ? 'error' : id === 'cancelled' ? 'idle' : 'complete', statusLabel: a.status ?? '실행 완료' } });
  }
  function connect(id: string, from: string, to: string, label: string, kind: string = 'record') {
    edges.push({ id, source: from, target: to, type: 'pyd-flow-edge', label,
      selected: edge === id, markerEnd: kind === 'membership' ? undefined : { type: MarkerType.ArrowClosed }, style: { strokeDasharray: kind === 'membership' ? '2 5' : kind === 'record' || kind === 'intent' ? '5 4' : undefined },
      ariaLabel: label });
  }
  if (scenario === 'assistant') {
    node('failed', 28, 90); node('cancelled', 316, 90); node('success', 604, 90);
    connect('retry', 'failed', 'cancelled', '재시도 요청', 'intent'); connect('resume', 'cancelled', 'success', '재개 요청', 'intent');
  } else if (view === 'Map' && !inside) {
    node('workspace', 20, 24); node('session', 324, 24); node('summary', 628, 24);
    node('coordinator', 324, 260); node('review', 628, 260);
    connect('workspace-session', 'workspace', 'session', 'Session 소속', 'membership');
    connect('session-agent', 'session', 'coordinator', '실행 소속', 'membership');
    connect('delegate-map', 'coordinator', 'review', '하위 Agent 위임', 'delegation');
    connect('result-map', 'coordinator', 'summary', '결과 작성', 'return');
  } else if (inside) {
    if (collapsed) node('review', 160, 100);
    else {
      nodes.push({ id: 'review-group', type: 'pyd-flow-group', position: { x: 12, y: 22 }, width: 600, height: 300, style: { width: 600, height: 300 },
        data: { title: '대화·실행 시도 검토', kindLabel: 'Agent 업무', description: 'guide-doc-reader · 파일 읽기 2회', group: { basis: 'native', collapsed: false, partial: false, cyclicMembers: 0 } } });
      node('journal', 40, 142); node('attempts', 356, 142);
      for (const n of nodes) if (n.id === 'journal' || n.id === 'attempts') { n.parentId = 'review-group'; n.extent = 'parent'; }
      connect('read-order', 'journal', 'attempts', '기록 순서');
    }
  } else {
    node('read', 20, 96); node('review', 324, 96); node('summary', 628, 96);
    connect('delegation', 'read', 'review', '기록 순서');
    connect('return', 'review', 'summary', '검토 결과 반환', 'return');
    if (depth === '기술 근거') {
      for (let n = 0; n < 6; n++) nodes.push({ id: 'model-' + n, type: 'pyd-flow-node', position: { x: 22 + (n % 3) * 304, y: 340 + Math.floor(n / 3) * 180 }, width: 226, height: 136, style: { width: 226, height: 136 }, data: { title: `모델 요청 ${n + 1}`, description: 'gpt-6-astra · 요청 종료 관측', kindLabel: '기술 근거', kind: 'action', status: 'idle', statusLabel: '업무 수용과 별도' } });
    }
  }
  const edgeDetails = edge === 'workspace-session' || edge === 'session-agent'
    ? { title: '명시된 소속', detail: '작업공간·Session·Agent의 원본 소속입니다. 포함 관계이며 실행 선행 조건을 뜻하지 않습니다.' }
    : edge === 'delegate-map'
    ? { title: '하위 Agent 위임', detail: '조정 Agent가 검토를 맡긴 명시적인 위임 관계입니다. 같은 이름이나 시각으로 추정한 연결이 아닙니다.' }
    : edge === 'result-map'
    ? { title: '결과 작성', detail: '조정 Agent가 작성한 최종 응답입니다. 하위 Agent의 독립 응답과 구별합니다.' }
    : edge === 'return'
    ? { title: '검토 결과 반환', detail: '하위 Agent가 반환한 검토를 조정 Agent가 받았습니다. 이 연결을 임의의 Projects 선행 업무로 확대하지 않습니다.' }
    : edge === 'retry' || edge === 'resume'
      ? { title: edge === 'retry' ? '재시도 요청' : '재개 요청', detail: '조정자 명령의 predecessor 연결입니다. 요청 의도이며 실행 성공이나 업무 수용을 보장하지 않습니다.' }
      : { title: '기록 순서', detail: '원본 저장 순서를 나타냅니다. 선행 조건·인과·업무 의존성을 뜻하지 않습니다.' };
  const summary = <><small className="eyebrow">{item.kind} · {item.status ?? '실행 완료'}</small><h2>{item.title}</h2><p className="owner">{item.owner}</p>
    <section><h3>맡은 목적</h3><p>{item.purpose}</p></section><section><h3>{selected === 'failed' ? '보고된 실패 원인' : '이 작업의 결과'}</h3><p>{item.result}</p></section>
    <p className="evidence-line">{item.evidence}</p>{selected === 'review' && <button className="primary" onClick={enter}>묶음 내부 보기 →</button>}
    {selected === 'summary' && <p className="warning">편집 필요 · 구형 요약 한도와 새 대화 페이지 한도를 구분해야 합니다.</p>}
    {selected === 'success' && <p className="warning">미수집 기록 · 당시 수집하지 않은 중간 대화·도구 응답은 제공되지 않습니다.</p>}
    <details><summary>전체 업무 문맥</summary><p>{titles[scenario]}</p><p>현재 선택 범위의 응답과 전체 Run의 응답은 별개로 표시합니다.</p></details>
  </>;
  return <div className="prototype"><header className="top"><button onClick={() => setNavOpen(!navOpen)} aria-label="탐색 접기·펼치기">☰</button><b className="brand"><span>A</span> Agent Track</b><span className="proposal-tag">기획 시안 R1 · 운영 아님</span><span className="top-note">실제 검증 사례 기반 · 문구는 기획용 재구성</span></header>
    <div className={'app-layout' + (!navOpen ? ' nav-hidden' : '')}>
      {navOpen && <aside className="nav"><div><small className="eyebrow">WORKSPACE</small><h2>업무 탐색</h2><p>전체 프로젝트</p></div><label>검토 사례<select value={scenario} onChange={e => changeScenario(e.target.value as typeof scenario)}><option value="demian">Demian · 문서 검토와 종합</option><option value="assistant">Assistant · 실패·취소·성공</option></select></label><nav aria-label="업무 선택"><p className="eyebrow">선택한 업무</p><button aria-current="page" className="nav-item">{titles[scenario]}</button></nav><details><summary>출처·연결 상태</summary><p>운영 연결 없음 · 이 시안은 API를 호출하지 않습니다.</p></details><p className="nav-foot">실행 완료 ≠ 결과 검증 ≠ 업무 수용<br/>현재 권한·관측 범위에서만 표시</p></aside>}
      <main><div className="work-header"><div className="breadcrumbs">업무 {inside ? ' / 대화·실행 시도 검토' : ' / 선택한 실행'}</div><div className="title-line"><h1>{titles[scenario]}</h1><span className="badge">실행 완료</span><span className="badge neutral">{scenario === 'demian' ? '내용 검토 필요' : 'Projects 검토'}</span></div><p>{scenario === 'demian' ? '문서 3개 확인 → 하위 검토 → 사용자 안내 종합' : '이전 실패와 취소를 보존하며 마지막 메모의 결과를 확인합니다.'}</p><div className="work-meta">{scenario === 'demian' ? '하위 Agent 1 · 도구 호출 4 · 대화 14항목 · 1,633자 응답' : '같은 업무의 실행 시도 3개 · 과거 수집 방식'}<span>{scenario === 'demian' ? 'Projects 업무 연결 없음' : 'Assistant 업무 시스템 / 명령 복구 QA'}</span></div></div>
      <nav className="view-tabs" aria-label="업무 보기">{['Track', 'Trail', 'Trace', 'Map'].map(v => <button key={v} aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}><strong>{v}</strong><span>{{Track:'현황',Trail:'업무 경과',Trace:'실행 과정',Map:'협업 관계'}[v]}</span></button>)}</nav>
      {view === 'Track' ? <section className="overview"><small className="eyebrow">선택한 업무의 현황</small><h2>무엇을 했고, 무엇이 남았나요?</h2><p>{scenario === 'demian' ? '문서 읽기와 하위 검토, 안내문 작성은 끝났습니다. 안내문의 조회 한도 설명을 편집해야 합니다.' : '점검 메모 작성은 끝났습니다. 실제 복구·업무 수용은 별도 근거로 판단합니다.'}</p><dl><dt>실행</dt><dd>성공 종료</dd><dt>산출물</dt><dd>{scenario === 'demian' ? '사용자 안내 초안 · 1,633자' : '명령 복구 QA 점검 메모'}</dd><dt>남은 판단</dt><dd>내용 검토 · 사용자 수용 미확인</dd></dl><button className="primary" onClick={() => setView('Trace')}>어떻게 수행했는지 보기 →</button></section>
      : <div className="workspace"><section className="primary-area"><div className="graph-toolbar"><div className="depth"><label>표시 깊이<select value={depth} onChange={e => {setDepth(e.target.value);setFit(fit+1);}}><option>업무 흐름</option><option>기술 근거</option></select></label></div><button onClick={() => {setInside(false);setFit(fit+1);}}>전체 업무</button><button onClick={() => setFit(fit+1)}>현재 범위 맞춤</button></div>
        {inside && <div className="scope-bar"><button onClick={() => {setInside(false);pick('review');}}>← 업무 흐름</button><strong>대화·실행 시도 검토</strong><span>원본 Agent 소속</span><button onClick={() => setCollapsed(!collapsed)}>{collapsed?'묶음 펼치기':'묶음 접기'}</button></div>}
        {view === 'Trail' ? <section className="trail"><h2>업무 경과</h2><p className="muted">도구 실행 결과와 그때의 메시지를 함께 읽습니다.</p>{(scenario==='demian'?['read','journal','attempts','summary']:['failed','cancelled','success']).map((id,index)=><button className="trail-item" key={id} onClick={()=>pick(id)}><span className="step">{index+1}</span><span><b>{items[id].title}</b><small>{items[id].owner}</small><p>{items[id].result}</p></span><span className="state-label">{items[id].status??'실행 완료'}</span></button>)}</section>
          : <><div className="canvas-label"><strong>{view==='Map'?'업무·Agent 협업 관계':'선택한 업무의 실행 흐름'}</strong><span>{inside?'묶음 내부':depth==='기술 근거'?'모델 요청 포함':'주요 작업과 반환 결과'}</span></div><FlowCanvas key={`${scenario}:${inside}:${collapsed}:${fit}:${depth}`} label="개선안 흐름" nodes={nodes} edges={edges} height="440px" showMiniMap={false} minZoom={0.55} onNodeClick={id=>{if(items[id])pick(id);else{setPane('근거');setEdge('model');}}} onEdgeClick={id=>setEdge(id)} onGroupToggle={()=>setCollapsed(!collapsed)} onGroupEnter={enter} readOnly />
          <div className="legend"><span>→ 위임·결과 반환: 원본 연결</span><span>┄ 기록 순서: 의존성 아님</span><span>명시 의존성이 있을 때만 선행 조건 표시</span></div></>}
        <details className="support"><summary>전체 대화·기술 근거를 더 살펴보기</summary><p>모델 요청 6회와 전체 이벤트 900개는 기술 근거에서 조회합니다. 기본 업무 흐름에서 생략해도 삭제하지 않습니다.</p><button onClick={()=>{setDepth('기술 근거');setView('Trace');setInside(false);}}>기술 근거 펼치기</button></details>
        <div className="node-shortcuts" aria-label="키보드로 작업 선택">{(scenario==='demian'?['read','review','journal','attempts','summary']:['failed','cancelled','success']).map(id=><button key={id} onClick={()=>pick(id)} aria-pressed={selected===id}>{items[id].title}</button>)}</div>
      </section><aside className="detail" aria-label="선택한 작업 상세"><div className="detail-top"><span>선택 범위</span><strong>{edge?'관계':item.owner}</strong></div>{edge?<><h2>{edgeDetails.title}</h2><p>{edgeDetails.detail}</p><button onClick={()=>setEdge(null)}>작업 상세로 돌아가기</button></>:<><nav className="detail-tabs" aria-label="상세 보기">{['요약','대화','도구','근거'].map(p=><button key={p} onClick={()=>setPane(p)} aria-current={pane===p?'page':undefined}>{p}</button>)}</nav>
        {pane==='요약'?summary:pane==='대화'?<><small className="eyebrow">현재 선택한 호출만</small><h2>{item.title}</h2>{scenario==='assistant'?<p className="warning">이전 수집 방식입니다. 원본이 제공하지 않는 중간 기록은 복원하지 않습니다.</p>:<><article className="message"><small>{item.owner} · 진행 메시지 예시</small><p>{selected==='review'?'두 문서를 읽고 대화 제공 범위와 이전 실행 시도 구분 기준을 확인하겠습니다.':item.purpose}</p></article><article className="message"><small>{item.owner} · 응답 예시</small><p>{item.result}</p></article><p className="muted">선택 범위에 맞는 원본 메시지를 순서대로 제공합니다. 이 시안의 문구는 재구성 예시입니다.</p></>}</>:pane==='도구' && (scenario==='assistant'||!['review','read','journal','attempts'].includes(selected))?<><h2>연결된 도구 없음</h2><p>이 선택 범위에 제공된 도구 기록이 없습니다. 다른 작업의 도구를 대신 표시하지 않습니다.</p></>:pane==='도구'?<><h2>선택 작업의 도구</h2>{(selected==='review'?['journal','attempts']:[selected]).map(id=><details className="tool" key={id} open><summary>{items[id]?.evidence??'원본 근거'}</summary><h3>입력</h3><pre>{JSON.stringify({path:id==='journal'?'docs/conversation-journal.md':id==='attempts'?'docs/assistant-attempts.md':'docs/inline-work-content.md'},null,2)}</pre><h3>응답</h3><p>{items[id]?.result}</p><small>시안에서는 응답을 축약했습니다. 제품은 원문과 부분·미리보기 여부를 구별합니다.</small></details>)}</>:<><h2>출처와 확인 범위</h2><p>{item.evidence}</p><dl><dt>표시 이름</dt><dd>원본 Agent·Task 이름 또는 도구 입력에 근거</dd><dt>업무 상태</dt><dd>실행·검증·Projects 수용 별도</dd><dt>이 시안</dt><dd>기획 검토용 재구성 · 운영 조회 없음</dd></dl><details><summary>원본 식별자</summary><p>실제 제품에서는 인가된 Run·invocation·call 식별자를 접힌 영역에 제공합니다.</p></details></>}
        {pane==='요약'&&<div className="detail-actions"><button onClick={()=>setPane('대화')}>이 작업의 대화</button><button onClick={()=>setPane('도구')}>입력·응답 확인</button></div>}</>}
      </aside></div>}
      <footer>기획 시안 · FlowCanvas는 기존 Track 컴포넌트 재사용 · 나머지 화면은 동작 검토용 구현 · 저장·실행·배포 기능 없음</footer>
      </main>
    </div></div>;
}
createRoot(document.getElementById('root')!).render(<Prototype />);
