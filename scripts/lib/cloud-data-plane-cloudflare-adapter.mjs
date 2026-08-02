// Cloudflare KV + Durable Object adapter for the cloud-data-plane generation
// contract. Step A pilot: node-safe (no `cloudflare:workers` import) so plain
// node tests can drive it against Miniflare-emulated bindings; importing or
// calling this module never creates a Cloudflare resource.
//
// Port mapping (architect's decision):
// - objectStore -> Workers KV. putIfAbsent reads back an existing key and
//   byte-compares before writing; content addressing makes a mismatch
//   unreachable in practice, but the guard stays.
// - ledger + pointerStore -> CloudDataPlaneCoordinator Durable Object via stub
//   fetch, so compareAndSwap is real CAS inside a storage transaction.

import {
  validateActivePointer,
  validatePublicationReceipt,
} from "./cloud-data-plane-generation.mjs";

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

async function coordinatorCall(coordinatorNamespace, action, payload) {
  const stub = coordinatorNamespace.get(coordinatorNamespace.idFromName(COORDINATOR_ID));
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

export function createCloudflareCloudDataPlane({ kvNamespace, coordinatorNamespace }) {
  if (!kvNamespace || !coordinatorNamespace) {
    fail("ADAPTER_CONFIG_INVALID", "kvNamespace and coordinatorNamespace are required");
  }
  return {
    objectStore: {
      async putIfAbsent(key, bytes) {
        const prior = await kvNamespace.get(key, { type: "arrayBuffer" });
        if (prior !== null) {
          if (!bytesEqual(new Uint8Array(prior), bytes)) fail("IMMUTABILITY_VIOLATION", key);
          return;
        }
        await kvNamespace.put(key, bytes);
      },
      async get(key) {
        const value = await kvNamespace.get(key, { type: "arrayBuffer" });
        return value === null ? null : new Uint8Array(value);
      },
    },
    ledger: {
      async prepare(receipt) {
        validatePublicationReceipt(receipt);
        await coordinatorCall(coordinatorNamespace, "ledger/prepare", { receipt });
      },
      async markPromoted(receipt) {
        validatePublicationReceipt(receipt);
        await coordinatorCall(coordinatorNamespace, "ledger/mark-promoted", { receipt });
      },
      async get(receiptId) {
        return coordinatorCall(coordinatorNamespace, "ledger/get", { receipt_id: receiptId });
      },
    },
    pointerStore: {
      async get() {
        return coordinatorCall(coordinatorNamespace, "pointer/get");
      },
      async compareAndSwap(expectedSequence, nextPointer) {
        validateActivePointer(nextPointer);
        await coordinatorCall(coordinatorNamespace, "pointer/compare-and-swap", {
          expected_sequence: expectedSequence,
          pointer: nextPointer,
        });
      },
    },
    async inspect() {
      const objectKeys = [];
      let cursor;
      do {
        const page = await kvNamespace.list({ cursor });
        for (const { name } of page.keys) objectKeys.push(name);
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      const { receipts, pointer } = await coordinatorCall(coordinatorNamespace, "inspect");
      return { object_keys: objectKeys.sort(), receipts, pointer };
    },
  };
}
