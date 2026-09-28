export type LiveFunctionCall = { id: string; name: string; args: Record<string, unknown> };
export type LiveToolResponse = { toolResponse: { functionResponses: { id: string; name: string; response: Record<string, unknown> }[] } };

/** A socket-owned bridge: duplicates spend nothing and cancelled work cannot speak. */
export function createLiveToolBridge(options: {
  execute: (call: LiveFunctionCall, signal: AbortSignal) => Promise<Record<string, unknown>>;
  send: (response: LiveToolResponse) => void;
}) {
  const pending = new Map<string, AbortController>();
  const seen = new Set<string>();
  let generation = 0;
  let disposed = false;
  function cancel(ids: readonly string[]) {
    for (const id of ids) { seen.add(id); pending.get(id)?.abort(); pending.delete(id); }
  }
  function reset() {
    generation++;
    cancel([...pending.keys()]);
  }
  function receive(value: unknown) {
    if (disposed || !value || typeof value !== "object") return;
    const calls = (value as { functionCalls?: unknown }).functionCalls;
    if (!Array.isArray(calls)) return;
    for (const item of calls.slice(0, 8)) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || item.id.length > 160
        || typeof item.name !== "string" || !item.args || typeof item.args !== "object" || Array.isArray(item.args)) continue;
      const call = item as LiveFunctionCall;
      if (seen.has(call.id)) continue;
      seen.add(call.id);
      // Bound memory during an unusually long socket without allowing replay.
      if (seen.size > 500) { disposed = true; reset(); return; }
      const epoch = generation;
      const controller = new AbortController();
      pending.set(call.id, controller);
      let work: Promise<Record<string, unknown>>;
      try {
        work = pending.size > 1
          ? Promise.resolve({ ok: false, error: "COACH_BUSY" })
          : options.execute(call, controller.signal);
      } catch { work = Promise.reject(new Error("COACH_UNAVAILABLE")); }
      void work.catch(() => ({ ok: false, error: "COACH_UNAVAILABLE" })).then(response => {
        if (disposed || epoch !== generation || controller.signal.aborted || pending.get(call.id) !== controller) return;
        pending.delete(call.id);
        try { options.send({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response }] } }); }
        catch { reset(); }
      });
    }
  }
  return { receive, cancel, reset, dispose: () => { disposed = true; reset(); } };
}
