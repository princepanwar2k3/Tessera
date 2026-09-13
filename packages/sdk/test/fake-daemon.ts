import type { BlockReceipt } from "@bsp/protocol";

/**
 * A scripted stand-in for the provider daemon, as a `fetch` implementation.
 *
 * The SDK must not depend on @bsp/daemon (the workspace rule: nothing depends on daemon),
 * and the real pairing is covered by tools/e2e. This exists to drive the
 * renewal loop through cases that are awkward to provoke against a real node:
 * a facilitator that fails twice, a window that closes, a stream that dies.
 */
export class FakeDaemon {
  readonly base = "http://daemon.test";
  private controller?: ReadableStreamDefaultController<Uint8Array>;
  private seq = 0;

  /** Blocks that have been settled. */
  readonly settled = new Set<number>();
  /** Payment attempts seen, in order, including retries. */
  readonly paymentAttempts: number[] = [];
  /** Fail this many payment submissions before accepting. */
  failPayments = 0;
  /** Answer the block resource with 425 this many times first. */
  windowClosedTimes = 0;
  jobClosed = false;

  blockSeconds = 10;
  leadSeconds = 4;
  pricePerBlock = "1500";

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.slice(this.base.length);

    if (path.endsWith("/events")) return this.openStream();
    if (path.endsWith("/artifacts")) {
      return json({ jobId: "j_test", status: "expired", artifacts: { stdout: "done", stderr: "" } });
    }

    const paymentMatch = path.match(/\/jobs\/[^/]+\/blocks\/(\d+)\/payment$/);
    if (paymentMatch && init?.method === "POST") {
      const blockIndex = Number(paymentMatch[1]);
      this.paymentAttempts.push(blockIndex);
      if (this.jobClosed) return json({ error: "job_closed" }, 410);
      if (this.failPayments > 0) {
        this.failPayments--;
        return json({ error: "facilitator_timeout" }, 402);
      }
      this.settled.add(blockIndex);
      return json(this.receipt(blockIndex));
    }

    const blockMatch = path.match(/\/jobs\/[^/]+\/blocks\/(\d+)$/);
    if (blockMatch) {
      const blockIndex = Number(blockMatch[1]);
      if (this.jobClosed) return json({ error: "job_closed" }, 410);
      if (this.settled.has(blockIndex)) return json(this.receipt(blockIndex));
      if (this.windowClosedTimes > 0) {
        this.windowClosedTimes--;
        return json({ error: "window_closed", windowOpensAt: new Date().toISOString() }, 425);
      }
      return json(this.requirement(blockIndex), 402);
    }

    return json({ error: "not_found" }, 404);
  };

  private openStream(): Response {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  /** Push one event onto the live stream. */
  emit(event: Record<string, unknown>): void {
    const seq = ++this.seq;
    const payload = JSON.stringify({ ...event, seq });
    this.controller?.enqueue(
      new TextEncoder().encode(`id: ${seq}\nevent: ${event["type"]}\ndata: ${payload}\n\n`),
    );
  }

  /** The `state` frame the daemon sends on connect. */
  emitState(over: Record<string, unknown> = {}): void {
    this.emit({
      type: "state",
      jobId: "j_test",
      job: {
        jobId: "j_test",
        status: "running",
        blockIndex: 1,
        paidThrough: 1,
        blockSeconds: this.blockSeconds,
        leadSeconds: this.leadSeconds,
        pricePerBlock: this.pricePerBlock,
        asset: "MOCK",
        clockStartedAt: new Date().toISOString(),
        boundaryAt: new Date(Date.now() + this.blockSeconds * 1000).toISOString(),
        ...over,
      },
    });
  }

  emitRenewal(blockIndex: number, msLeft = 4000): void {
    this.emit({
      type: "renewal",
      jobId: "j_test",
      blockIndex,
      windowOpensAt: new Date().toISOString(),
      boundaryAt: new Date(Date.now() + msLeft).toISOString(),
      msLeft,
      requirement: this.requirement(blockIndex),
    });
  }

  emitTerminated(reason = "unpaid_boundary", finalBlockIndex = 1): void {
    this.jobClosed = true;
    this.emit({
      type: "terminated",
      jobId: "j_test",
      reason,
      finalBlockIndex,
      receipt: {
        v: 1,
        protocol: "bsp/0.1",
        type: "terminated",
        jobId: "j_test",
        reason,
        finalBlockIndex,
      },
    });
  }

  requirement(blockIndex: number) {
    const boundaryAt = new Date(Date.now() + this.blockSeconds * 1000);
    return {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "hedera-testnet",
          asset: "MOCK",
          payTo: "0.0.PROVIDER",
          maxAmountRequired: this.pricePerBlock,
          resource: `/jobs/j_test/blocks/${blockIndex}`,
          description: `Block ${blockIndex}`,
          facilitator: "https://facilitator.test",
        },
      ],
      blockMeta: {
        protocol: "bsp/0.1",
        jobId: "j_test",
        blockIndex,
        blockSeconds: this.blockSeconds,
        leadSeconds: this.leadSeconds,
        clockStartedAt: new Date().toISOString(),
        windowOpensAt: new Date(boundaryAt.getTime() - this.leadSeconds * 1000).toISOString(),
        boundaryAt: boundaryAt.toISOString(),
      },
    };
  }

  receipt(blockIndex: number): BlockReceipt {
    return {
      v: 1,
      protocol: "bsp/0.1",
      type: "block_receipt",
      jobId: "j_test",
      blockIndex,
      asset: "MOCK",
      amount: this.pricePerBlock,
      txId: `0.0.999999@1757844000.${String(blockIndex).padStart(9, "0")}`,
      clockStartedAt: "2026-09-14T10:00:00.000Z",
      boundaryAt: "2026-09-14T10:00:30.000Z",
    };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
