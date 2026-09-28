// CloudDataPlaneCoordinator Durable Object (workerd-only). Holds the cloud
// data plane's publication ledger and active pointer in transactional storage
// so compareAndSwap is real CAS and prepare/markPromoted are atomic. Follows
// the WindDownReviewCoordinator binding pattern (worker.ts); the wrangler
// binding itself is a later gated step — Step A wires it via Miniflare.
//
// The node-safe adapter (cloud-data-plane-cloudflare-adapter.mjs) reaches these
// operations through stub fetch with JSON bodies; contract error codes are
// propagated in the error payload so the adapter can rethrow them verbatim.

import { DurableObject } from "cloudflare:workers";

import {
  validateActivePointer,
  validatePublicationReceipt,
} from "./cloud-data-plane-generation.mjs";
import { canonicalJson } from "./json-canonical.mjs";

const POINTER_KEY = "pointer";
const RECEIPT_PREFIX = "receipt:";

function fail(code, detail) {
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  throw error;
}

export class CloudDataPlaneCoordinator extends DurableObject {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    try {
      const payload = await request.json();
      const result = await this.dispatch(pathname, payload);
      return Response.json({ result });
    } catch (error) {
      return Response.json(
        { error: { code: error.code ?? "COORDINATOR_INTERNAL", detail: error.message } },
        { status: 409 },
      );
    }
  }

  dispatch(action, payload) {
    switch (action) {
      case "/ledger/prepare":
        return this.prepare(payload.receipt);
      case "/ledger/mark-promoted":
        return this.markPromoted(payload.receipt);
      case "/ledger/get":
        return this.getReceipt(payload.receipt_id);
      case "/pointer/get":
        return this.getPointer();
      case "/pointer/compare-and-swap":
        return this.compareAndSwap(payload.expected_sequence, payload.pointer);
      case "/inspect":
        return this.inspect();
      default:
        fail("COORDINATOR_ACTION_UNKNOWN", action);
    }
  }

  prepare(receipt) {
    validatePublicationReceipt(receipt);
    return this.ctx.storage.transaction(async () => {
      const key = RECEIPT_PREFIX + receipt.receipt_id;
      const prior = (await this.ctx.storage.get(key)) ?? null;
      if (prior && canonicalJson(prior) !== canonicalJson(receipt)) {
        fail("RECEIPT_CONFLICT", receipt.receipt_id);
      }
      await this.ctx.storage.put(key, receipt);
    });
  }

  markPromoted(receipt) {
    validatePublicationReceipt(receipt);
    return this.ctx.storage.transaction(async () => {
      const key = RECEIPT_PREFIX + receipt.receipt_id;
      const prior = (await this.ctx.storage.get(key)) ?? null;
      if (!prior || prior.state !== "prepared") fail("RECEIPT_NOT_PREPARED", receipt.receipt_id);
      await this.ctx.storage.put(key, receipt);
    });
  }

  async getReceipt(receiptId) {
    return (await this.ctx.storage.get(RECEIPT_PREFIX + receiptId)) ?? null;
  }

  async getPointer() {
    return (await this.ctx.storage.get(POINTER_KEY)) ?? null;
  }

  compareAndSwap(expectedSequence, nextPointer) {
    return this.ctx.storage.transaction(async () => {
      const pointer = (await this.ctx.storage.get(POINTER_KEY)) ?? null;
      const actualSequence = pointer?.sequence ?? 0;
      if (actualSequence !== expectedSequence) {
        fail("STALE_WRITER", `${expectedSequence}:${actualSequence}`);
      }
      validateActivePointer(nextPointer);
      if (nextPointer.sequence !== expectedSequence + 1) {
        fail("POINTER_SEQUENCE_INVALID", `${expectedSequence}:${nextPointer.sequence}`);
      }
      await this.ctx.storage.put(POINTER_KEY, nextPointer);
    });
  }

  async inspect() {
    const stored = await this.ctx.storage.list({ prefix: RECEIPT_PREFIX });
    const receipts = [...stored.values()]
      .sort((left, right) => left.receipt_id.localeCompare(right.receipt_id));
    const pointer = (await this.ctx.storage.get(POINTER_KEY)) ?? null;
    return { receipts, pointer };
  }
}
