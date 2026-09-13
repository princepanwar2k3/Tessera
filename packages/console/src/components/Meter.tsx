import { useEffect, useState } from "react";
import { buildStrip, type MeterState } from "../lib/meter-state.js";
import { assetLabel } from "../lib/format.js";

interface Props {
  state: MeterState;
  /** Injectable for tests. */
  now?: number;
}

/**
 * The meter. The signature element, and the only thing on the page that moves.
 *
 * Read as an instrument face rather than a chart: a rail of readouts across
 * the top, a recessed tape below it with one cell per block of service, and a
 * cursor showing how far into the current block the clock has run. The tape
 * fills left to right; at window open the serving block takes an amber ring
 * and the countdown lights; when payment stops the tape freezes and the last
 * block goes red.
 */
export function Meter({ state, now: fixedNow }: Props) {
  const now = useNow(fixedNow, state.terminated === undefined);
  const snap = state.snapshot;
  const cells = buildStrip(state, now);
  const current = cells.find((c) => c.tone === "current");

  const spent = state.receipts.reduce((total, r) => total + BigInt(r.amount), 0n).toString();
  const msLeft =
    state.terminated === undefined && state.windowBoundaryAt !== undefined
      ? Math.max(0, state.windowBoundaryAt - now)
      : undefined;

  const blockSeconds = snap?.blockSeconds ?? 0;
  const intoBlock = current ? current.fill * blockSeconds : 0;

  return (
    <section className="meter card" aria-label="Payment meter">
      <div className="readouts">
        <Readout label="Blocks paid" value={String(state.receipts.length)} />
        <Readout label="Spent" value={spent} unit={assetLabel(snap?.asset)} />
        <Readout label="Block size" value={blockSeconds ? `${blockSeconds}` : "—"} unit="sec" />
        <Readout
          label={state.terminated ? "Stopped at" : "Into block"}
          value={state.terminated ? String(state.terminated.finalBlockIndex) : intoBlock.toFixed(1)}
          unit={state.terminated ? "" : "sec"}
          tone={state.terminated ? "expired" : undefined}
        />
      </div>

      <div className="tape" role="img" aria-label={describe(state, cells.length)}>
        <div className="tape__cells">
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
                <>
                  <div className="block__fill" style={{ width: `${cell.fill * 100}%` }} />
                  <div className="block__cursor" style={{ left: `${cell.fill * 100}%` }} />
                </>
              )}
              <span className="block__index">{cell.index}</span>
            </div>
          ))}
          {/* The tape runs on past what has been bought, so the boundary
              between paid and unpaid is a place on it, not the end of it. */}
          <div className="tape__unbought" aria-hidden="true" />
        </div>
      </div>

      <div className="meter__foot">
        <span className={`status status--${state.terminated ? "expired" : (snap?.status ?? "starting")}`}>
          {statusCopy(state)}
        </span>
        {msLeft !== undefined && (
          <span className="countdown">
            <span className="countdown__pip" aria-hidden="true" />
            Renewal window — {(msLeft / 1000).toFixed(1)}s to pay
          </span>
        )}
      </div>
    </section>
  );
}

function Readout({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string | undefined;
  tone?: "expired" | undefined;
}) {
  return (
    <div className="readout">
      <span className="readout__label">{label}</span>
      <span className={`readout__value${tone ? ` readout__value--${tone}` : ""}`}>
        {value}
        {unit ? <span className="readout__unit">{unit}</span> : null}
      </span>
    </div>
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

/** Ticks only while the job is live, and only as often as the tape can show. */
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
