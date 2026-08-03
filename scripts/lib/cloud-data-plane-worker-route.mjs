// Authenticated internal route that lets a CI writer reach the cloud data
// plane's ledger and active pointer.
//
// Why this exists: the publisher runs in GitHub Actions, where it can write R2
// objects directly over the REST API, but it cannot get compare-and-swap on the
// pointer. Real CAS lives in the CloudDataPlaneCoordinator Durable Object, and
// a Durable Object is only reachable from inside a Worker. This route is that
// door, and nothing more.
//
// It is a verbatim proxy on purpose: the coordinator's status and body are
// returned unchanged so the contract's error codes (STALE_WRITER,
// RECEIPT_CONFLICT, POINTER_SEQUENCE_INVALID, ...) reach the writer intact and
// the writer can act on them. The route never reads or writes application
// state, and payload bytes never travel through it — objects go straight to R2.

const ROUTE_PREFIX = "/internal/cloud-data-plane/";

// Mirrors CloudDataPlaneCoordinator.dispatch. An unknown action is refused here
// rather than forwarded, so a typo cannot spend a Durable Object request.
const ALLOWED_ACTIONS = new Set([
  "ledger/prepare",
  "ledger/mark-promoted",
  "ledger/get",
  "pointer/get",
  "pointer/compare-and-swap",
  "inspect",
]);

const COORDINATOR_ID = "cloud-data-plane-coordinator";

// Receipts and pointers are ~1 KB. Payloads are not supposed to come through
// here at all, so anything large is a mistake worth refusing early.
const MAX_BODY_BYTES = 65_536;

function typed(status, code, detail) {
  return Response.json(
    { error: { code, detail } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

// Length-independent comparison. The keys are fixed-length hex in practice, but
// the compare must not leak the answer through timing for any input.
function secretEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

export function isCloudDataPlaneRoute(pathname) {
  return pathname.startsWith(ROUTE_PREFIX);
}

// Returns a Response for our route, or null when the request belongs to the
// application. Callers must treat null as "not handled" and fall through.
export async function handleCloudDataPlaneRequest(request, env) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (!isCloudDataPlaneRoute(url.pathname)) return null;

  const action = url.pathname.slice(ROUTE_PREFIX.length);
  if (request.method !== "POST") {
    return typed(405, "METHOD_NOT_ALLOWED", request.method);
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return typed(404, "COORDINATOR_ACTION_UNKNOWN", action);
  }

  const configuredKey = env?.DATA_PLANE_WRITE_KEY;
  if (typeof configuredKey !== "string" || configuredKey.length < 32) {
    // Fail closed and say so: an unconfigured door is a deployment fault, not
    // an authentication failure, and the two must not look alike in logs.
    return typed(503, "DATA_PLANE_KEY_UNCONFIGURED", "worker secret missing or too short");
  }
  if (!secretEqual(request.headers.get("x-data-plane-key") ?? "", configuredKey)) {
    return typed(401, "DATA_PLANE_KEY_REJECTED", action);
  }

  const namespace = env?.CLOUD_DATA_PLANE_COORDINATOR;
  if (!namespace || typeof namespace.idFromName !== "function") {
    return typed(503, "DATA_PLANE_COORDINATOR_UNBOUND", action);
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return typed(413, "DATA_PLANE_BODY_TOO_LARGE", String(body.length));
  }

  const stub = namespace.get(namespace.idFromName(COORDINATOR_ID));
  const forwarded = await stub.fetch(`https://cloud-data-plane-coordinator/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body.length === 0 ? "{}" : body,
  });
  // Verbatim: status and body both. The contract error codes are the writer's
  // control flow, so re-wrapping them here would break it.
  return new Response(forwarded.body, {
    status: forwarded.status,
    headers: {
      "content-type": forwarded.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
