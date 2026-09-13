import type { TickerLine } from "../lib/types.js";
import { isRealTransaction, transactionUrl } from "../lib/explorer.js";
import { assetLabel } from "../lib/format.js";

/**
 * The receipt ticker. Everything here was produced by a machine, so all of it
 * is mono — transaction ids, amounts, block numbers.
 *
 * A real transaction id links to HashScan. A settlement nobody can check is
 * just a number on a page, and the whole claim of this project is that the
 * billing history is public.
 */
export function Ticker({
  lines,
  asset,
  fixedHeight = false,
}: {
  lines: TickerLine[];
  asset?: string | undefined;
  fixedHeight?: boolean;
}) {
  return (
    <section className={`card ticker${fixedHeight ? " ticker--fixed" : ""}`} aria-label="Receipts">
      <h2>Receipts</h2>
      {lines.length === 0 ? (
        <p className="empty">No blocks settled yet.</p>
      ) : (
        <ol>
          {lines.map((line, i) => (
            <li key={`${line.kind}-${line.blockIndex}-${i}`} data-kind={line.kind}>
              <span className="ticker__what">{line.text}</span>
              {line.txId &&
                (isRealTransaction(line.txId) ? (
                  <a
                    className="tx tx--link"
                    href={transactionUrl(line.txId)}
                    target="_blank"
                    rel="noreferrer"
                    title="View on HashScan"
                  >
                    {line.txId}
                  </a>
                ) : (
                  <span className="tx">{line.txId}</span>
                ))}
              {line.amount && (
                <span className="amount">
                  {line.amount}
                  {asset ? ` ${assetLabel(asset)}` : ""}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
