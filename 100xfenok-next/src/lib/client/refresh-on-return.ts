/** Recheck visible data when the reader returns, without background polling. */
export function refreshOnReturn(
  refresh: () => void,
  windowTarget: EventTarget = window,
  documentTarget: EventTarget & { readonly visibilityState: string } = document,
): () => void {
  let pending = false;
  let disposed = false;
  const notify = () => {
    if (disposed || pending || documentTarget.visibilityState === "hidden") return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (!disposed && documentTarget.visibilityState !== "hidden") refresh();
    });
  };
  const events = ["focus", "pageshow", "online"];
  for (const event of events) windowTarget.addEventListener(event, notify);
  documentTarget.addEventListener("visibilitychange", notify);
  return () => {
    disposed = true;
    for (const event of events) windowTarget.removeEventListener(event, notify);
    documentTarget.removeEventListener("visibilitychange", notify);
  };
}
