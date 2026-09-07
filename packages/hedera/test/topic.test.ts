import { describe, expect, it } from 'vitest';
import { serializeReceiptCanonical, type BlockReceipt, type Receipt } from '@bsp/protocol';
import { ReceiptTopic } from '../src/topic.js';
import type { HcsClient, HcsMessage, SubmitResult } from '../src/topic.js';

const receipt = (over: Partial<BlockReceipt> = {}): BlockReceipt => ({
  v: 1,
  protocol: 'bsp/0.1',
  type: 'block_receipt',
  jobId: 'job_7',
  blockIndex: 3,
  asset: 'HBAR',
  amount: '100000',
  txId: '0.0.4242@1757844000.123456789',
  clockStartedAt: '2026-09-07T10:00:00.000Z',
  boundaryAt: '2026-09-07T10:01:30.000Z',
  ...over,
});

class FakeHcs implements HcsClient {
  sent: { topicId: string; message: string }[] = [];
  messages: HcsMessage[] = [];
  private seq = 0;

  async createTopic(opts: { memo: string }): Promise<string> {
    return `0.0.9${opts.memo.length}`;
  }

  async submitMessage(topicId: string, message: string): Promise<SubmitResult> {
    this.sent.push({ topicId, message });
    this.seq += 1;
    const m: HcsMessage = {
      contents: message,
      sequenceNumber: this.seq,
      consensusTimestamp: `1757844000.00000000${this.seq}`,
    };
    this.messages.push(m);
    return { txId: `0.0.4242@1757844000.00000000${this.seq}`, sequenceNumber: this.seq };
  }

  async readMessages(_topicId: string): Promise<HcsMessage[]> {
    return this.messages;
  }
}

describe('receipt topic: publishing', () => {
  it('puts exactly the canonical bytes on the topic', async () => {
    const hcs = new FakeHcs();
    const topic = new ReceiptTopic(hcs, '0.0.5555');
    const r = receipt();
    await topic.publish(r);
    expect(hcs.sent).toEqual([{ topicId: '0.0.5555', message: serializeReceiptCanonical(r) }]);
  });

  it('refuses to publish a malformed receipt — consensus messages are permanent', async () => {
    const hcs = new FakeHcs();
    const topic = new ReceiptTopic(hcs, '0.0.5555');
    const bad = { ...receipt(), blockIndex: 0 };
    await expect(topic.publish(bad)).rejects.toThrow(/blockIndex/);
    expect(hcs.sent).toEqual([]);
  });

  it('reports where the receipt landed, so a renter can go look at it', async () => {
    const hcs = new FakeHcs();
    const topic = new ReceiptTopic(hcs, '0.0.5555');
    const result = await topic.publish(receipt());
    expect(result.sequenceNumber).toBe(1);
    expect(result.txId).toMatch(/^0\.0\.\d+@\d+\.\d+$/);
  });
});

describe('receipt topic: reading back', () => {
  const seed = async (hcs: FakeHcs, receipts: Receipt[]) => {
    const topic = new ReceiptTopic(hcs, '0.0.5555');
    for (const r of receipts) await topic.publish(r);
    return topic;
  };

  it("returns only the asked-for job's receipts, in block order", async () => {
    const hcs = new FakeHcs();
    const topic = await seed(hcs, [
      receipt({ blockIndex: 2 }),
      receipt({ jobId: 'other_job', blockIndex: 1 }),
      receipt({ blockIndex: 1 }),
      receipt({ blockIndex: 3 }),
    ]);
    const mine = await topic.receiptsFor('job_7');
    expect(mine.map((r) => (r as BlockReceipt).blockIndex)).toEqual([1, 2, 3]);
    expect(mine.every((r) => r.jobId === 'job_7')).toBe(true);
  });

  it('skips noise on the shared topic instead of throwing', async () => {
    const hcs = new FakeHcs();
    const topic = await seed(hcs, [receipt({ blockIndex: 1 })]);
    await hcs.submitMessage('0.0.5555', 'not json at all');
    await hcs.submitMessage('0.0.5555', JSON.stringify({ hello: 'world' }));
    await hcs.submitMessage('0.0.5555', JSON.stringify({ ...receipt(), v: 2 }));
    const mine = await topic.receiptsFor('job_7');
    expect(mine).toHaveLength(1);
  });

  it('carries a terminal receipt back too, so a renter sees how the job ended', async () => {
    const hcs = new FakeHcs();
    const topic = await seed(hcs, [
      receipt({ blockIndex: 1 }),
      { v: 1, protocol: 'bsp/0.1', type: 'terminated', jobId: 'job_7', reason: 'unpaid_boundary', finalBlockIndex: 1 },
    ]);
    const mine = await topic.receiptsFor('job_7');
    expect(mine.map((r) => r.type)).toEqual(['block_receipt', 'terminated']);
  });
});

describe('receipt topic: creation', () => {
  it('creates the shared topic and hands back a topic bound to it', async () => {
    const { createReceiptTopic } = await import('../src/topic.js');
    const hcs = new FakeHcs();
    const topic = await createReceiptTopic(hcs);
    expect(topic.topicId).toMatch(/^0\.0\.\d+$/);
    await topic.publish(receipt());
    expect(hcs.sent[0]!.topicId).toBe(topic.topicId);
  });

  it('stamps the topic with a memo naming the protocol', async () => {
    const { createReceiptTopic } = await import('../src/topic.js');
    const memos: string[] = [];
    const hcs = new FakeHcs();
    const spy: HcsClient = {
      ...hcs,
      createTopic: async (o) => (memos.push(o.memo), hcs.createTopic(o)),
      submitMessage: hcs.submitMessage.bind(hcs),
      readMessages: hcs.readMessages.bind(hcs),
    };
    await createReceiptTopic(spy);
    expect(memos).toEqual(['bsp/0.1 receipts']);
  });
});
