/**
 * Deterministic fake x402 facilitator for offline dev + CI (Phase 1 Track B).
 *
 * Real contract (exact HTTP shapes, auth, timing) is recorded in
 * docs/facilitator-contract.md during Phase 0 from OBSERVED behaviour.
 * This fake mirrors the SPEC §6.1 assumption — synchronous verify/settle —
 * and is switchable by env var (`FACILITATOR_MODE=real|fake`) in later phases.
 *
 * Behaviours:
 *  - success:   verify ok, settle mints a txId immediately.
 *  - slow:      like success but delayed by latencyMs (default 1500).
 *  - timeout:   settle never resolves within the window (rejects after timeoutMs).
 *  - verifyReject: verify returns invalid (insufficient funds / wrong asset).
 *
 * Idempotence: settle is keyed on (jobId, blockIndex, amount, asset).
 * A duplicate settle returns the ORIGINAL txId — never a second charge.
 * That is what lets the daemon implement SPEC §6.3's 200-with-receipt.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';

export type FacilitatorBehaviour =
  | 'success'
  | 'slow'
  | 'timeout'
  | 'verifyReject'
  // 'duplicate' is an alias for 'success': idempotent settle (same txId for
  // the same key, never a second charge) is always on, in every behaviour.
  // The name exists so tests can name the SPEC §6.3 duplicate case directly.
  | 'duplicate';

export interface SettleKey {
  jobId: string;
  blockIndex: number;
  amount: string;
  asset: string;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  latencyMs: number;
}

export interface SettleResult {
  txId: string;
  duplicate: boolean;
  latencyMs: number;
}

export interface FakeFacilitatorOptions {
  behaviour?: FacilitatorBehaviour;
  /** Added latency for `slow` (and measured on all paths). */
  latencyMs?: number;
  /** How long `timeout` waits before rejecting. */
  timeoutMs?: number;
  operatorId?: string;
}

const keyOf = (k: SettleKey) => `${k.jobId}:${k.blockIndex}:${k.asset}:${k.amount}`;

export class FakeFacilitator {
  behaviour: FacilitatorBehaviour;
  latencyMs: number;
  timeoutMs: number;
  operatorId: string;
  private settled = new Map<string, string>();
  private counter = 0;

  constructor(opts: FakeFacilitatorOptions = {}) {
    this.behaviour = opts.behaviour ?? 'success';
    this.latencyMs = opts.latencyMs ?? 1500;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.operatorId = opts.operatorId ?? '0.0.1234';
  }

  setBehaviour(b: FacilitatorBehaviour): void {
    this.behaviour = b;
  }

  settledCount(): number {
    return this.settled.size;
  }

  private mintTxId(now: number): string {
    this.counter += 1;
    const nanos = String(now * 1_000_000 + this.counter).padStart(9, '0').slice(-9);
    return `${this.operatorId}@${Math.floor(now / 1000)}.${nanos}`;
  }

  async verify(_key: SettleKey): Promise<VerifyResult> {
    if (this.behaviour === 'verifyReject') {
      return { valid: false, reason: 'insufficient_funds', latencyMs: 0 };
    }
    if (this.behaviour === 'slow') {
      await sleep(this.latencyMs);
      return { valid: true, latencyMs: this.latencyMs };
    }
    return { valid: true, latencyMs: 0 };
  }

  async settle(key: SettleKey): Promise<SettleResult> {
    const k = keyOf(key);
    const existing = this.settled.get(k);
    if (existing) return { txId: existing, duplicate: true, latencyMs: 0 };

    if (this.behaviour === 'timeout') {
      await sleep(this.timeoutMs);
      throw new Error('facilitator timeout');
    }
    if (this.behaviour === 'slow') {
      await sleep(this.latencyMs);
    }
    const txId = this.mintTxId(Date.now());
    this.settled.set(k, txId);
    return { txId, duplicate: false, latencyMs: this.behaviour === 'slow' ? this.latencyMs : 0 };
  }

  /** Tiny HTTP shim: POST /verify and POST /settle with JSON bodies. */
  listen(port = 0): Promise<{ server: Server; url: string }> {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        (async () => {
          try {
            const parsed = body ? (JSON.parse(body) as SettleKey) : ({} as SettleKey);
            if (req.url === '/verify' && req.method === 'POST') {
              const r = await this.verify(parsed);
              res.writeHead(r.valid ? 200 : 402, { 'content-type': 'application/json' });
              res.end(JSON.stringify(r));
            } else if (req.url === '/settle' && req.method === 'POST') {
              const r = await this.settle(parsed);
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify(r));
            } else {
              res.writeHead(404, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ error: 'not_found' }));
            }
          } catch (err) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
        })();
      });
    });
    return new Promise((resolve) => {
      server.listen(port, () => {
        const addr = server.address();
        const p = typeof addr === 'object' && addr ? addr.port : port;
        resolve({ server, url: `http://127.0.0.1:${p}` });
      });
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
