/**
 * Publishing receipts to the topic without putting consensus on the
 * settlement path.
 *
 * The daemon awaits `record()` immediately before returning `200` for a
 * settled block. Two things follow, and both matter:
 *
 *  - Consensus takes seconds. A 10 s block with a 4 s window has no seconds
 *    to spare, so a sink that waited for consensus could push the renter past
 *    the boundary it just paid to cross.
 *  - The payment has already settled by the time we are called. Money moved.
 *    Failing the response over a *publishing* problem would tell the renter
 *    their paid block was not paid. SPEC §10 makes publishing RECOMMENDED,
 *    not required for conformance — so it must never be able to fail
 *    settlement.
 *
 * So `record()` enqueues and returns. A single drain loop publishes in order,
 * and failures are counted and reported rather than thrown or swallowed.
 */
import type { PrivateKey } from '@hiero-ledger/sdk';
import type { Receipt } from '@bsp/protocol';
import type { ReceiptTopic } from './topic.js';
import { signReceipt } from './signing.js';

export interface HcsReceiptSinkOptions {
  topic: ReceiptTopic;
  /** Provider key. A provider-only signature is evidence of a claim (§6.2). */
  signWith?: PrivateKey;
  /** Called for a receipt that could not be published. */
  onError?: (error: Error, receipt: Receipt) => void;
}

export class HcsReceiptSink {
  private readonly topic: ReceiptTopic;
  private readonly signWith: PrivateKey | undefined;
  private readonly onError: ((error: Error, receipt: Receipt) => void) | undefined;

  private queue: Receipt[] = [];
  private draining: Promise<void> | null = null;
  private publishedCount = 0;
  private failedCount = 0;

  constructor(opts: HcsReceiptSinkOptions) {
    this.topic = opts.topic;
    this.signWith = opts.signWith;
    this.onError = opts.onError;
  }

  /** Receipts published to the topic. */
  get published(): number {
    return this.publishedCount;
  }

  /** Receipts that could not be published. */
  get failed(): number {
    return this.failedCount;
  }

  /** Receipts still waiting to go out. */
  get pending(): number {
    return this.queue.length + (this.draining === null ? 0 : 1);
  }

  async record(receipt: Receipt): Promise<void> {
    this.queue.push(receipt);
    this.startDraining();
  }

  /** Await the queue. For shutdown, and for tests that need the outcome. */
  async drain(): Promise<void> {
    while (this.draining !== null) await this.draining;
  }

  private startDraining(): void {
    if (this.draining !== null) return;
    this.draining = this.drainLoop();
  }

  private async drainLoop(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const receipt = this.queue.shift()!;
        try {
          await this.topic.publish(
            this.signWith === undefined ? receipt : signReceipt(receipt, this.signWith, 'provider'),
          );
          this.publishedCount += 1;
        } catch (err) {
          this.failedCount += 1;
          this.onError?.(err instanceof Error ? err : new Error(String(err)), receipt);
        }
      }
    } finally {
      // Cleared in the same synchronous turn that saw the queue empty. Doing
      // it in a `.finally()` on the promise instead leaves a microtask gap in
      // which `record()` sees a drain still running, declines to start one,
      // and orphans the receipt it just enqueued.
      this.draining = null;
    }
  }
}
