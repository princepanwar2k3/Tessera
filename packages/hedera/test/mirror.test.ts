import { describe, expect, it } from 'vitest';
import { MirrorNodeReader } from '../src/mirror.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');

const page = (messages: unknown[], next: string | null = null) =>
  new Response(JSON.stringify({ messages, links: { next } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('mirror node read path (SPEC §8 — verify without trusting the facilitator)', () => {
  it('decodes the base64 message bodies the mirror node returns', async () => {
    const calls: string[] = [];
    const reader = new MirrorNodeReader({
      baseUrl: 'https://testnet.mirrornode.hedera.com',
      fetch: async (url) => {
        calls.push(String(url));
        return page([
          { consensus_timestamp: '1757844000.000000001', sequence_number: 1, message: b64('{"jobId":"job_7"}') },
        ]);
      },
    });
    const messages = await reader.readMessages('0.0.5555');
    expect(messages).toEqual([
      { contents: '{"jobId":"job_7"}', sequenceNumber: 1, consensusTimestamp: '1757844000.000000001' },
    ]);
    expect(calls[0]).toContain('/api/v1/topics/0.0.5555/messages');
  });

  it('follows the next link, so a shared topic is never silently truncated', async () => {
    const calls: string[] = [];
    const reader = new MirrorNodeReader({
      baseUrl: 'https://testnet.mirrornode.hedera.com',
      fetch: async (url) => {
        calls.push(String(url));
        if (calls.length === 1) {
          return page(
            [{ consensus_timestamp: '1757844000.000000001', sequence_number: 1, message: b64('one') }],
            '/api/v1/topics/0.0.5555/messages?order=asc&timestamp=gt:1757844000.000000001',
          );
        }
        return page([
          { consensus_timestamp: '1757844000.000000002', sequence_number: 2, message: b64('two') },
        ]);
      },
    });
    const messages = await reader.readMessages('0.0.5555');
    expect(messages.map((m) => m.contents)).toEqual(['one', 'two']);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(
      'https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.5555/messages?order=asc&timestamp=gt:1757844000.000000001',
    );
  });

  it('raises the mirror node error instead of reporting an empty history', async () => {
    const reader = new MirrorNodeReader({
      fetch: async () => new Response('{"_status":{"messages":[{"message":"Not found"}]}}', { status: 404 }),
    });
    await expect(reader.readMessages('0.0.5555')).rejects.toThrow(/404/);
  });

  it('defaults to the testnet mirror node', async () => {
    const calls: string[] = [];
    const reader = new MirrorNodeReader({
      fetch: async (url) => (calls.push(String(url)), page([])),
    });
    await reader.readMessages('0.0.5555');
    expect(calls[0]).toContain('https://testnet.mirrornode.hedera.com/');
  });
});
