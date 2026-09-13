import { useEffect, useState } from "react";
import { fetchLedger, type LedgerReceipt } from "../lib/api.js";
import { HCS_TOPIC_ID, isRealTransaction, topicUrl, transactionUrl } from "../lib/explorer.js";
import { assetLabel } from "../lib/format.js";

/**
 * The public billing history, read back from Hedera.
 *
 * These rows do not come from this system's own database — they are fetched
 * from the consensus topic through a mirror node, which is the whole reason
 * for publishing them. A provider quietly shortening blocks is detectable
 * here rather than merely deniable.
 */
export function Ledger({ jobId }: { jobId?: string | undefined }) {
  const [receipts, setReceipts] = useState<LedgerReceipt[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchLedger(jobId)
        .then((rows) => {
          if (cancelled) return;
          setReceipts(rows);
          setError(undefined);
        })
        .catch((err: Error) => !cancelled && setError(err.message))
        .finally(() => !cancelled && setLoading(false));

    void load();
    const id = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [jobId]);

  return (
    <section className="card panel" aria-label="Consensus log">
      <div className="ledger__head">
        <h2>On the consensus log</h2>
        {HCS_TOPIC_ID && (
          <a href={topicUrl(HCS_TOPIC_ID)} target="_blank" rel="noreferrer" className="mono-link">
            topic {HCS_TOPIC_ID}
          </a>
        )}
      </div>

      <p className="empty" style={{ marginBottom: "0.7rem" }}>
        Read back from Hedera through a mirror node — not from this marketplace&apos;s own
        records. Anyone can check these without asking the provider.
      </p>

      {error && <p className="error">{error}</p>}
      {!error && loading && <p className="empty">Reading the topic…</p>}
      {!error && !loading && receipts.length === 0 && (
        <p className="empty">Nothing published yet.</p>
      )}

      {receipts.length > 0 && (
        <div className="scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>Block</th>
                <th>Amount</th>
                <th>Transaction</th>
                <th>Signed by</th>
              </tr>
            </thead>
            <tbody>
              {[...receipts].reverse().map((r, i) => (
                <tr key={`${r.jobId}-${r.blockIndex ?? "end"}-${i}`}>
                  <td>
                    {r.type === "block_receipt" ? (
                      r.blockIndex
                    ) : (
                      <span className="ledger__end">ended · {r.reason}</span>
                    )}
                  </td>
                  <td className="mono">
                    {r.amount ? `${r.amount} ${assetLabel(r.asset)}` : "—"}
                  </td>
                  <td className="mono">
                    {r.txId && isRealTransaction(r.txId) ? (
                      <a href={transactionUrl(r.txId)} target="_blank" rel="noreferrer">
                        {r.txId}
                      </a>
                    ) : (
                      (r.txId ?? "—")
                    )}
                  </td>
                  <td className="mono ledger__uaid" title={r.providerUaid ?? ""}>
                    {shortUaid(r.providerUaid)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** HCS-14 identifiers are long; show enough to recognise one. */
function shortUaid(uaid?: string): string {
  if (!uaid) return "—";
  if (!uaid.startsWith("uaid:")) return uaid;
  const [head] = uaid.split(";");
  return head && head.length > 26 ? `${head.slice(0, 26)}…` : (head ?? uaid);
}
