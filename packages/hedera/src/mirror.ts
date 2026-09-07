/**
 * Mirror-node read path — SPEC §8.
 *
 * The facilitator tells the renter a payment settled. The mirror node lets
 * the renter check that claim against consensus without asking the
 * facilitator anything, which is the whole point of publishing receipts.
 *
 * The consensus service has no request/response read API — `TopicMessageQuery`
 * is a subscription — so the read path is the mirror node's REST interface.
 */
import type { HcsMessage } from './topic.js';

export const TESTNET_MIRROR_NODE = 'https://testnet.mirrornode.hedera.com';
export const MAINNET_MIRROR_NODE = 'https://mainnet.mirrornode.hedera.com';

type FetchLike = (url: string) => Promise<Response>;

export interface MirrorNodeOptions {
  baseUrl?: string;
  fetch?: FetchLike;
}

interface MirrorMessage {
  consensus_timestamp: string;
  sequence_number: number;
  message: string;
}

export class MirrorNodeReader {
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;

  constructor(opts: MirrorNodeOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? TESTNET_MIRROR_NODE).replace(/\/$/, '');
    this.fetch = opts.fetch ?? ((url) => globalThis.fetch(url));
  }

  async readMessages(topicId: string, opts?: { limit?: number }): Promise<HcsMessage[]> {
    const params = new URLSearchParams({ order: 'asc' });
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));

    const out: HcsMessage[] = [];
    let path: string | null = `/api/v1/topics/${topicId}/messages?${params.toString()}`;
    while (path !== null) {
      const res: Response = await this.fetch(`${this.baseUrl}${path}`);
      if (!res.ok) {
        // An empty history and an unreachable mirror node mean opposite things
        // to a renter auditing a job. Never let one look like the other.
        throw new Error(`mirror node ${res.status} for ${path}`);
      }
      const body = (await res.json()) as {
        messages?: MirrorMessage[];
        links?: { next?: string | null };
      };
      for (const m of body.messages ?? []) out.push(toHcsMessage(m));
      path = body.links?.next ?? null;
    }
    return out;
  }
}

function toHcsMessage(m: MirrorMessage): HcsMessage {
  return {
    contents: Buffer.from(m.message, 'base64').toString('utf8'),
    sequenceNumber: m.sequence_number,
    consensusTimestamp: m.consensus_timestamp,
  };
}
