import type { TickerLine } from "../lib/types.js";

/**
 * The receipt ticker. Everything here was produced by a machine, so all of it
 * is mono — transaction ids, amounts, block numbers.
 */
export function Ticker({ lines }: { lines: TickerLine[] }) {
  return (
    <section className="card ticker" aria-label="Receipts">
      <h2>Receipts</h2>
      {lines.length === 0 ? (
        <p className="empty">No blocks settled yet.</p>
      ) : (
        <ol>
          {lines.map((line, i) => (
            <li key={`${line.kind}-${line.blockIndex}-${i}`} data-kind={line.kind}>
              <span>{line.text}</span>
              {line.txId && <span className="tx">{line.txId}</span>}
              {line.amount && <span className="amount">{line.amount}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
