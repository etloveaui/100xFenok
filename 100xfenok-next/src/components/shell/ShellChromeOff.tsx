import type { ReactNode } from "react";

/**
 * Opts one render of a shell route out of the persistent chrome — used by the
 * legacy `?v1=1` full-page views, which predate the shell and draw their own.
 * The rule lives in app-shell.css as `.fnk-shell:has([data-shell-chrome="off"])`,
 * so the server-rendered HTML is already chrome-less (no flash, no JS).
 */
export default function ShellChromeOff({ children }: { children: ReactNode }) {
  return (
    <div data-shell-chrome="off" style={{ display: "contents" }}>
      {children}
    </div>
  );
}
