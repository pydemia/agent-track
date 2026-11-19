import { useState, type ReactNode } from "react";

/** Closed panels do not mount readers or consume the selected work's read budget. */
export function DeferredDetails({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return <details className={className} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{summary}</summary>{open && children}
  </details>;
}
