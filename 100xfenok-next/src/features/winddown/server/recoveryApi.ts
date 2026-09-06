const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

type RecoveryDependencies = {
  authenticated(): Promise<boolean>;
  exportSnapshot(): Promise<unknown>;
  restoreCopy(snapshot: unknown): Promise<unknown>;
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

async function readBackupBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_BACKUP_BYTES) throw new Error("WINDDOWN_RECOVERY_TOO_LARGE");
  if (!request.body) throw new Error("WINDDOWN_RECOVERY_SNAPSHOT_INVALID");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BACKUP_BYTES) {
        await reader.cancel();
        throw new Error("WINDDOWN_RECOVERY_TOO_LARGE");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof Error && error.message === "WINDDOWN_RECOVERY_TOO_LARGE") throw error;
    throw new Error("WINDDOWN_RECOVERY_SNAPSHOT_INVALID");
  } finally {
    reader.releaseLock();
  }
}

export async function executeWindDownRecoveryRequest(
  request: Request,
  deps: RecoveryDependencies,
): Promise<Response> {
  if (!(await deps.authenticated())) return json({ error: "ADMIN_SESSION_REQUIRED" }, 401);
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET, POST" });
  }
  try {
    if (request.method === "GET") {
      const snapshot = await deps.exportSnapshot();
      return json(snapshot, 200, {
        "Content-Disposition": 'attachment; filename="winddown-learning-backup.json"',
      });
    }
    const origin = request.headers.get("origin");
    if (origin !== new URL(request.url).origin) {
      return json({ error: "WINDDOWN_RECOVERY_ORIGIN_INVALID" }, 403);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return json({ error: "WINDDOWN_RECOVERY_CONTENT_TYPE_INVALID" }, 415);
    }
    const snapshot = await readBackupBody(request);
    return json(await deps.restoreCopy(snapshot));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : error instanceof Error ? error.message : "";
    // Never serialize an exception or raw record into responses or logs.
    if (code === "WINDDOWN_RECOVERY_TOO_LARGE") return json({ error: code }, 413);
    if (code === "WINDDOWN_RECOVERY_SNAPSHOT_INVALID") return json({ error: code }, 400);
    if (code === "WINDDOWN_RECOVERY_TARGET_NOT_EMPTY" || code === "WINDDOWN_RECOVERY_TARGET_CORRUPT") {
      return json({ error: code }, 409);
    }
    return json({ error: "WINDDOWN_RECOVERY_UNAVAILABLE" }, 503);
  }
}
