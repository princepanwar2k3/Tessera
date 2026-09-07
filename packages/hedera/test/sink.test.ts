import { describe, expect, it, vi } from 'vitest';
import { PrivateKey } from '@hiero-ledger/sdk';
import type { BlockReceipt, Receipt } from '@bsp/protocol';
import { ReceiptTopic, type HcsClient, type HcsMessage, type SubmitResult } from '../src/topic.js';
import { HcsReceiptSink } from '../src/sink.js';

const receipt = (over: Partial<BlockReceipt> = {}): BlockReceipt => ({
  v: 1,
  protocol: 'bsp/0.1',
  type: 'block_receipt',
  jobId: 'job_7',
  blockIndex: 1,
  asset: 'HBAR',
  amount: '100000',
  txId: '0.0.4242@1757844000.123456789',
  clockStartedAt: '2026-09-07T10:00:00.000Z',
  boundaryAt: '2026-09-07T10:00:30.000Z',
  ...over,
});

/** An HCS client whose submits only finish when the test says so. */
class BlockingHcs implements HcsClient {
  sent: string[] = [];
  private releases: (() => void)[] = [];
  private seq = 0;

  async createTopic(): Promise<string> {
    return '0.0.5555';
  }

  submitMessage(_topicId: string, message: string): Promise<SubmitResult> {
    this.sent.push(message);
    this.seq += 1;
    const seq = this.seq;
    return new Promise((resolve) => {
      this.releases.push(() => resolve({ txId: `0.0.1@1.${seq}`, sequenceNumber: seq }));
    });
  }

  async readMessages(): Promise<HcsMessage[]> {
    return [];
  }

  releaseAll(): void {
    for (const r of this.releases.splice(0)) r();
  }
}

const sinkOn = (hcs: HcsClient, extra: Record<string, unknown> = {}) =>
  new HcsReceiptSink({ topic: new ReceiptTopic(hcs, '0.0.5555'), ...extra });

describe('HcsReceiptSink: settlement must not wait on consensus', () => {
  it('resolves record() while the publish is still in flight', async () => {
    const hcs = new BlockingHcs();
    const sink = sinkOn(hcs);

    // If record() awaited the publish, this would hang until releaseAll().
    await expect(sink.record(receipt())).resolves.toBeUndefined();
    expect(sink.published).toBe(0);
    expect(sink.pending).toBe(1);

    hcs.releaseAll();
    await sink.drain();
    expect(sink.published).toBe(1);
  });
});

describe('HcsReceiptSink: a publish failure is not a settlement failure', () => {
  const failingHcs = (): HcsClient => ({
    createTopic: async () => '0.0.5555',
    submitMessage: async () => {
      throw new Error('CONSENSUS_TOPIC_NOT_FOUND');
    },
    readMessages: async () => [],
  });

  it('never throws into the caller, because the payment already settled', async () => {
    const sink = sinkOn(failingHcs());
    await expect(sink.record(receipt())).resolves.toBeUndefined();
    await expect(sink.drain()).resolves.toBeUndefined();
  });

  it('reports the failure instead of swallowing it', async () => {
    const seen: { error: Error; receipt: Receipt }[] = [];
    const sink = sinkOn(failingHcs(), {
      onError: (error: Error, r: Receipt) => seen.push({ error, receipt: r }),
    });
    await sink.record(receipt({ blockIndex: 2 }));
    await sink.drain();
    expect(sink.failed).toBe(1);
    expect(sink.published).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.error.message).toMatch(/CONSENSUS_TOPIC_NOT_FOUND/);
    expect((seen[0]!.receipt as BlockReceipt).blockIndex).toBe(2);
  });

  it('keeps publishing later receipts after one fails', async () => {
    let calls = 0;
    const flaky: HcsClient = {
      createTopic: async () => '0.0.5555',
      submitMessage: async () => {
        calls += 1;
        if (calls === 1) throw new Error('transient');
        return { txId: `0.0.1@1.${calls}`, sequenceNumber: calls };
      },
      readMessages: async () => [],
    };
    const sink = sinkOn(flaky);
    await sink.record(receipt({ blockIndex: 1 }));
    await sink.record(receipt({ blockIndex: 2 }));
    await sink.drain();
    expect(sink.failed).toBe(1);
    expect(sink.published).toBe(1);
  });
});

describe('HcsReceiptSink: what lands on the topic', () => {
  it('signs with the provider key before publishing', async () => {
    const hcs = new BlockingHcs();
    const key = PrivateKey.generateED25519();
    const sink = sinkOn(hcs, { signWith: key });
    await sink.record(receipt());
    hcs.releaseAll();
    await sink.drain();
    const published = JSON.parse(hcs.sent[0]!) as BlockReceipt;
    expect(published.providerSig).toBeTypeOf('string');
    const { verifyReceiptSignature } = await import('../src/signing.js');
    expect(verifyReceiptSignature(published, key.publicKey, 'provider')).toBe(true);
  });

  it('publishes in block order, so the topic reads as the job ran', async () => {
    // Descending latency: the last receipt is the quickest to submit. If the
    // sink published concurrently these would land 3, 2, 1.
    const delays: Record<number, number> = { 1: 40, 2: 20, 3: 5 };
    const sent: number[] = [];
    const slowestFirst: HcsClient = {
      createTopic: async () => '0.0.5555',
      submitMessage: async (_t, message) => {
        const r = JSON.parse(message) as BlockReceipt;
        await new Promise((resolve) => setTimeout(resolve, delays[r.blockIndex]));
        sent.push(r.blockIndex);
        return { txId: `0.0.1@1.${r.blockIndex}`, sequenceNumber: r.blockIndex };
      },
      readMessages: async () => [],
    };
    const sink = sinkOn(slowestFirst);
    for (const n of [1, 2, 3]) await sink.record(receipt({ blockIndex: n }));
    await sink.drain();
    expect(sent).toEqual([1, 2, 3]);
    expect(sink.published).toBe(3);
  });
});

describe('HcsReceiptSink: enqueueing while a drain is finishing', () => {
  it('publishes a receipt recorded in the gap between drains', async () => {
    const sent: number[] = [];
    const instant: HcsClient = {
      createTopic: async () => '0.0.5555',
      submitMessage: async (_t, message) => {
        const r = JSON.parse(message) as BlockReceipt;
        sent.push(r.blockIndex);
        return { txId: `0.0.1@1.${r.blockIndex}`, sequenceNumber: r.blockIndex };
      },
      readMessages: async () => [],
    };
    const sink = sinkOn(instant);

    // Record, then let a handful of microtasks pass — enough for the drain
    // loop to empty the queue but not necessarily to finish tearing down —
    // then record again. The second receipt must not be orphaned.
    for (let block = 1; block <= 6; block++) {
      await sink.record(receipt({ blockIndex: block }));
      await Promise.resolve();
    }
    await sink.drain();

    expect(sink.failed).toBe(0);
    expect(sent).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sink.published).toBe(6);
  });
});

describe('HcsReceiptSink: signing configuration', () => {
  it('accepts a DER-encoded key string, so callers need not import the SDK', async () => {
    const hcs = new BlockingHcs();
    const key = PrivateKey.generateECDSA();
    const sink = sinkOn(hcs, { signWith: key.toStringDer() });

    expect(sink.signs).toBe(true);
    await sink.record(receipt());
    hcs.releaseAll();
    await sink.drain();

    const { verifyReceiptSignature } = await import('../src/signing.js');
    const published = JSON.parse(hcs.sent[0]!) as BlockReceipt;
    expect(verifyReceiptSignature(published, key.publicKey, 'provider')).toBe(true);
  });

  it('reports when it is publishing unsigned receipts', () => {
    expect(sinkOn(new BlockingHcs()).signs).toBe(false);
  });
});
