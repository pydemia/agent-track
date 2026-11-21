import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Only authored web/mail links. Relative links have no reliable source-app base. */
export function readableUrl(value: string): string | undefined {
  if (/[\u0000-\u0020\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function ReadableText({ text, label = "본문", format = "markdown" }: { text: string; label?: string; format?: "markdown" | "json" | "text" }) {
  const [raw, setRaw] = useState(false);
  let json = text;
  if (format === "json") { try { json = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Partial input stays verbatim. */ } }
  return <div className="readable-text">
    <div className="reading-mode" role="group" aria-label={`${label} 표시 방식`}>
      <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>읽기</button>
      <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>원문</button>
    </div>
    <div className={`work-readable ${raw || format === "text" ? "work-raw" : "work-markdown"}`} tabIndex={0} aria-label={label}>
      {raw || format === "text" ? text : format === "json" ? <pre><code>{json}</code></pre> : <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={readableUrl}
        components={{ a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noreferrer noopener">{children} ↗</a> : <span>{children}</span>,
          img: ({ alt }) => <span className="graph-legend">[이미지: {alt || "설명 없음"} · 자동 로드하지 않음]</span>,
          table: ({ children }) => <div className="reading-table" tabIndex={0}><table>{children}</table></div> }}>{text}</Markdown>}
    </div>
  </div>;
}
