import { useEffect, useState } from "react";
import { buildStrip, type MeterState } from "../lib/meter-state.js";

interface Props {
  state: MeterState;
  /** Injectable for tests and for the scripted demo on the landing page. */
  now?: number;
}

/**
 * The meter. The signature element, and the only thing on the page that moves.
 *
 * A horizontal strip of blocks, left to right. The current block fills in real
 * time; at window open it outlines amber with a countdown; on settlement the
 * next block snaps into existence in `--settled`. When payment stops the strip
 * freezes and the final block goes `--expired`.
 */
export function Meter({ state, now: fixedNow }: Props) {
  const now = useNow(fixedNow, state.terminated === undefined);
  const snap = state.snapshot;
  const cells = buildStrip(state, now);

  const spent = state.receipts.reduce((total, r) => total + BigInt(r.amount), 0n).toString();
  // Amber carries information, so it must never outlive the thing it means.
  // A terminated job has no open window, whatever the last event said.
  const msLeft =
    state.terminated === undefined && state.windowBoundaryAt !== undefined
      ? Math.max(0, state.windowBoundaryAt - now)
      : undefined;

  return (
    <section className="card meter" aria-label="Payment meter">
      <div className="meter__head">
        <p className="meter__count">
          {state.receipts.length}
          <span>{state.receipts.length === 1 ? "block paid" : "blocks paid"}</span>
        </p>
        <p className="meter__spend">
          <b>
            {spent} {snap?.asset ?? ""}
          </b>
          {snap ? `${snap.blockSeconds}s blocks · ${snap.pricePerBlock} each` : "—"}
        </p>
      </div>

      <div className="strip" role="img" aria-label={describe(state, cells.length)}>
        {cells.map((cell) => (
          <div
            key={cell.index}
            className={[
              "block",
              `block--${cell.tone}`,
              cell.windowOpen ? "block--window" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {cell.tone === "current" && (
              <div className="block__fill" style={{ width: `${cell.fill * 100}%` }} />
            )}
            <span className="block__index">{cell.index}</span>
          </div>
        ))}
      </div>

      <div className="meter__foot">
        <span className={`status status--${state.terminated ? "expired" : (snap?.status ?? "starting")}`}>
          {statusCopy(state)}
        </span>
        {msLeft !== undefined && (
          <span className="countdown">
            Renewal window open — {(msLeft / 1000).toFixed(1)}s to pay
          </span>
        )}
      </div>
    </section>
  );
}

function statusCopy(state: MeterState): string {
  if (state.terminated) return `Terminated at block ${state.terminated.finalBlockIndex}`;
  const snap = state.snapshot;
  if (!snap) return "Waiting for the job";
  if (snap.status === "awaiting_payment") return "Waiting for the first block to settle";
  if (snap.status === "starting") return "Starting — provisioning is not billed";
  return `Serving block ${snap.blockIndex}`;
}

function describe(state: MeterState, total: number): string {
  const paid = state.receipts.length;
  if (state.terminated) return `${paid} blocks paid, terminated at block ${total}.`;
  return `${paid} of ${total} blocks paid.`;
}

/** Ticks only while the job is live, and only as often as the strip can show. */
function useNow(fixed: number | undefined, live: boolean): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());

  useEffect(() => {
    if (fixed !== undefined || !live) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const id = window.setInterval(() => setNow(Date.now()), reduced ? 1000 : 100);
    return () => window.clearInterval(id);
  }, [fixed, live]);

  return fixed ?? now;
}
