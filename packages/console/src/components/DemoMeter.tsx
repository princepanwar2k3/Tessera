import { useCallback, useEffect, useReducer, useState } from "react";
import { emptyMeterState, reduceMeter } from "../lib/meter-state.js";
import type { JobEvent } from "../lib/types.js";
import { Meter } from "./Meter.js";
import { Ticker } from "./Ticker.js";

const BLOCK_SECONDS = 10;
const LEAD_SECONDS = 4;
const PRICE = "1500";
/** Blocks the demo renter buys before stopping. The last one then expires. */
const BLOCKS_BOUGHT = 5;
/** How long the finished job stays on screen before the next run. */
const REPLAY_PAUSE_MS = 5000;

/**
 * The landing page opens with a meter running, before any explanatory copy.
 *
 * Scripted rather than live: a judge opening the page with no provider node
 * running should still see the thing the project is about. It runs the real
 * reducer over real event shapes, so what it shows is what a live job shows —
 * including the ending, where the renter stops buying and the final block
 * expires at the boundary.
 */
export function DemoMeter() {
  const [cycle, setCycle] = useState(0);
  // Stable identity: DemoCycle's effect depends on this, and the page around
  // it re-renders on every registry poll. An inline arrow would restart the
  // whole schedule several times a minute.
  const onFinished = useCallback(() => setCycle((c) => c + 1), []);

  return (
    <>
      {/* Remounting per cycle is the reset. The reducer has no reset action on
          purpose: in the real console a `state` event arrives on every stream
          reconnect and must never wipe the receipts already shown. */}
      <DemoCycle key={cycle} onFinished={onFinished} />
      <p className="empty" style={{ margin: "0.6rem 0 0" }}>
        A sample job at {BLOCK_SECONDS}s blocks with a {LEAD_SECONDS}s renewal window. Block size
        is set per listing; the default is 30s.
      </p>
    </>
  );
}

function DemoCycle({ onFinished }: { onFinished: () => void }) {
  const [state, dispatch] = useReducer(reduceMeter, emptyMeterState);

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(() => !cancelled && fn(), Math.max(0, ms)));
    };

    const startedAt = Date.now();
    const boundaryOf = (block: number) => startedAt + block * BLOCK_SECONDS * 1000;
    const iso = (ms: number) => new Date(ms).toISOString();

    dispatch({
      type: "state",
      jobId: "demo",
      job: {
        jobId: "demo",
        status: "running",
        blockIndex: 1,
        paidThrough: 1,
        blockSeconds: BLOCK_SECONDS,
        leadSeconds: LEAD_SECONDS,
        pricePerBlock: PRICE,
        asset: "HBAR",
        clockStartedAt: iso(startedAt),
        boundaryAt: iso(boundaryOf(1)),
      },
    });
    dispatch(blockEvent(1, startedAt));

    for (let block = 1; block <= BLOCKS_BOUGHT; block++) {
      const boundary = boundaryOf(block);
      const windowOpens = boundary - LEAD_SECONDS * 1000;

      at(windowOpens - startedAt, () =>
        dispatch({
          type: "renewal",
          jobId: "demo",
          blockIndex: block + 1,
          windowOpensAt: iso(windowOpens),
          boundaryAt: iso(boundary),
          msLeft: LEAD_SECONDS * 1000,
        }),
      );

      if (block < BLOCKS_BOUGHT) {
        // Settles partway through the window, as a real renter does.
        at(windowOpens - startedAt + 1500, () => dispatch(blockEvent(block + 1, startedAt)));
        at(boundary - startedAt, () =>
          dispatch({
            type: "advanced",
            jobId: "demo",
            blockIndex: block + 1,
            boundaryAt: iso(boundaryOf(block + 1)),
          }),
        );
      } else {
        // The renter stops buying. The window closes unpaid and the watchdog
        // ends the job at the boundary — not a second before.
        at(boundary - startedAt, () =>
          dispatch({
            type: "terminated",
            jobId: "demo",
            reason: "unpaid_boundary",
            finalBlockIndex: block,
            receipt: { reason: "unpaid_boundary", finalBlockIndex: block },
          }),
        );
        // Then run again, so the page is never a frozen screenshot.
        at(boundary - startedAt + REPLAY_PAUSE_MS, onFinished);
      }
    }

    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
    };
  }, [onFinished]);

  return (
    <>
      <Meter state={state} />
      <Ticker lines={state.ticker} fixedHeight />
    </>
  );
}

function blockEvent(blockIndex: number, startedAt: number): JobEvent {
  return {
    type: "block",
    jobId: "demo",
    blockIndex,
    receipt: {
      blockIndex,
      amount: PRICE,
      asset: "HBAR",
      txId: `0.0.4417${blockIndex}@${Math.floor(startedAt / 1000)}.${String(
        blockIndex * 137,
      ).padStart(9, "0")}`,
    },
  };
}
