"use client"

import { useEffect, useState } from "react"
import { ExecutionContextSummary } from "../track-shared/context/ExecutionSummary.tsx"
import { scopeKey, startTrackContextPolling, type TrackContextScope, type TrackContextView } from "../lib/track-context-client"
import "./track-context-panel.css"

export type TrackContextPanelProps = TrackContextScope & { refreshKey: string }

export function TrackContextPanel(props: TrackContextPanelProps) {
  const { refreshKey, ...scope } = props
  const key = scopeKey(scope)
  const [entry, setEntry] = useState<{ key: string; view: TrackContextView }>()
  const [retry, setRetry] = useState(0)

  useEffect(() => startTrackContextPolling(scope, (view) => setEntry({ key, view }), undefined), [key, refreshKey, retry])

  const view = entry?.key === key ? entry.view : undefined
  if (!view || view.kind === "hidden") return null
  if (view.kind === "error") return <section className="trackContextPanel" aria-label="Track 실행 요약">
    <p role="status">연결된 실행 요약을 불러오지 못했습니다.</p>
    <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button>
  </section>
  return <details className="trackContextPanel">
    <summary>연결된 실행 요약</summary>
    <ExecutionContextSummary result={view.result} label="연결된 실행 요약" />
  </details>
}
