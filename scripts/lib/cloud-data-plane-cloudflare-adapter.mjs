// Cloudflare R2 + Durable Object adapter for the cloud-data-plane generation
// contract. Step B pilot: node-safe (no `cloudflare:workers` import) so plain
// node tests can drive it against Miniflare-emulated bindings; importing or
// calling this module never creates a Cloudflare resource.
//
// Port mapping (architect's decision):
// - objectStore -> Workers R2 bucket binding. putIfAbsent heads/gets the
//   existing key and byte-compares before writing; content addressing makes a
//   mismatch unreachable in practice, but the guard stays. putIfAbsent
//   resolves { written, alreadyPresent } so the caller skips the redundant
//   immediate readback only when the object already existed byte-identically.
// - ledger + pointerStore -> CloudDataPlaneCoordinator Durable Object via stub
//   fetch, so compareAndSwap is real CAS inside a storage transaction.

import {
  validateActivePointer,
  validatePublicationReceipt,
} from "./cloud-data-plane-generation.mjs";

// One coordinator Durable Object instance PER FAMILY: coordinatorName selects
// the instance (idFromName), so each family gets its own pointer, ledger and
// sequence and no publish can displace another family's active generation. The
// default is the legacy constant, so a caller that declares no name keeps
// talking to the instance that already holds history — nothing existing
// changes shape.

const COORDINATOR_ID = "cloud-data-plane-coordinator";

function fail(code, detail) {
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  throw error;
}

function bytesEqual(left, right) {
  const leftBytes = left instanceof Uint8Array ? left : new Uint8Array(left);
  const rightBytes = right instanceof Uint8Array ? right : new Uint8Array(right);
  return leftBytes.length === rightBytes.length
    && leftBytes.every((byte, index) => byte === rightBytes[index]);
}

async function coordinatorCall(coordinatorNamespace, action, payload, coordinatorName = COORDINATOR_ID) {
  const stub = coordinatorNamespace.get(coordinatorNamespace.idFromName(coordinatorName));
  const response = await stub.fetch(`https://cloud-data-plane-coordinator/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const body = await response.json();
  if (!response.ok) {
    fail(body?.error?.code ?? "COORDINATOR_UNAVAILABLE", body?.error?.detail ?? action);
  }
  return body.result;
}

export function createCloudflareCloudDataPlane({ r2Bucket, coordinatorNamespace, coordinatorName = COORDINATOR_ID }) {
  if (!r2Bucket || !coordinatorNamespace) {
    fail("ADAPTER_CONFIG_INVALID", "r2Bucket and coordinatorNamespace are required");
  }
  return {
    objectStore: {
      async putIfAbsent(key, bytes) {
        const prior = await r2Bucket.get(key);
        if (prior !== null) {
          const priorBytes = new Uint8Array(await prior.arrayBuffer());
          if (!bytesEqual(priorBytes, bytes)) fail("IMMUTABILITY_VIOLATION", key);
          return { written: false, alreadyPresent: true };
        }
        await r2Bucket.put(key, bytes);
        return { written: true, alreadyPresent: false };
      },
      async get(key) {
        const object = await r2Bucket.get(key);
        if (object === null) return null;
        return new Uint8Array(await object.arrayBuffer());
      },
    },
    ledger: {
      async prepare(receipt) {
        validatePublicationReceipt(receipt);
        await coordinatorCall(coordinatorNamespace, "ledger/prepare", { receipt }, coordinatorName);
      },
      async markPromoted(receipt) {
        validatePublicationReceipt(receipt);
        await coordinatorCall(coordinatorNamespace, "ledger/mark-promoted", { receipt }, coordinatorName);
      },
      async get(receiptId) {
        return coordinatorCall(coordinatorNamespace, "ledger/get", { receipt_id: receiptId }, coordinatorName);
      },
    },
    pointerStore: {
      async get() {
        return coordinatorCall(coordinatorNamespace, "pointer/get", undefined, coordinatorName);
      },
      async compareAndSwap(expectedSequence, nextPointer) {
        validateActivePointer(nextPointer);
        await coordinatorCall(coordinatorNamespace, "pointer/compare-and-swap", {
          expected_sequence: expectedSequence,
          pointer: nextPointer,
        }, coordinatorName);
      },
    },
    async inspect() {
      const objectKeys = [];
      let cursor;
      do {
        const page = await r2Bucket.list({ cursor });
        for (const { key } of page.objects) objectKeys.push(key);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      const { receipts, pointer } = await coordinatorCall(coordinatorNamespace, "inspect", undefined, coordinatorName);
      return { object_keys: objectKeys.sort(), receipts, pointer };
    },
  };
}
