import type { BlockReceipt, JobEvent, JobSnapshot, TickerLine } from "./types.js";

export interface MeterState {
  snapshot?: JobSnapshot | undefined;
  receipts: BlockReceipt[];
  ticker: TickerLine[];
  /** The block whose renewal window is open, if any. */
  windowFor?: number | undefined;
  windowBoundaryAt?: number | undefined;
  terminated?: { reason: string; finalBlockIndex: number } | undefined;
}

export const emptyMeterState: MeterState = { receipts: [], ticker: [] };

/**
 * Fold the daemon's event stream into what the meter draws.
 *
 * Pure, so the display logic that matters — which block is amber, when the
 * strip freezes — is testable without a browser, a socket or a clock.
 */
export function reduceMeter(state: MeterState, event: JobEvent): MeterState {
  switch (event.type) {
    case "state":
      return { ...state, snapshot: event.job };

    case "renewal":
      return {
        ...state,
        windowFor: event.blockIndex,
        windowBoundaryAt: Date.parse(event.boundaryAt),
      };

    case "block": {
      if (state.receipts.some((r) => r.blockIndex === event.receipt.blockIndex)) return state;
      const receipts = [...state.receipts, event.receipt].sort(
        (a, b) => a.blockIndex - b.blockIndex,
      );
      return {
        ...state,
        receipts,
        // Settling the block the window was open for closes that window, so
        // amber disappears the instant it stops being true.
        ...(state.windowFor === event.receipt.blockIndex
          ? { windowFor: undefined, windowBoundaryAt: undefined }
          : {}),
        snapshot: state.snapshot
          ? {
              ...state.snapshot,
              paidThrough: Math.max(state.snapshot.paidThrough, event.receipt.blockIndex),
            }
          : state.snapshot,
        ticker: [
          {
            kind: "block",
            blockIndex: event.receipt.blockIndex,
            text: `block ${event.receipt.blockIndex} settled`,
            txId: event.receipt.txId,
            amount: event.receipt.amount,
          },
          ...state.ticker,
        ],
      };
    }

    case "advanced":
      return {
        ...state,
        snapshot: state.snapshot
          ? {
              ...state.snapshot,
              blockIndex: event.blockIndex,
              boundaryAt: event.boundaryAt,
              status: "running",
            }
          : state.snapshot,
        ...(state.windowFor !== undefined && state.windowFor <= event.blockIndex
          ? { windowFor: undefined, windowBoundaryAt: undefined }
          : {}),
      };

    case "terminated":
      return {
        ...state,
        windowFor: undefined,
        windowBoundaryAt: undefined,
        terminated: { reason: event.reason, finalBlockIndex: event.finalBlockIndex },
        snapshot: state.snapshot
          ? { ...state.snapshot, status: event.reason === "unpaid_boundary" ? "expired" : "closed" }
          : state.snapshot,
        ticker: [
          {
            kind: "terminated",
            blockIndex: event.finalBlockIndex,
            text: terminationCopy(event.reason, event.finalBlockIndex),
          },
          ...state.ticker,
        ],
      };
  }
}

/** Errors say what happened and what it means, in the interface's voice. */
export function terminationCopy(reason: string, finalBlockIndex: number): string {
  if (reason === "unpaid_boundary") {
    return `Renewal window closed. Job ended at block ${finalBlockIndex}.`;
  }
  if (reason === "completed") return `Service finished during block ${finalBlockIndex}.`;
  return `Job ended at block ${finalBlockIndex}: ${reason}.`;
}

export type BlockTone = "settled" | "current" | "expired" | "future";

export interface BlockCell {
  index: number;
  tone: BlockTone;
  /** 0–1, only meaningful for the current block. */
  fill: number;
  windowOpen: boolean;
}

/**
 * The strip, as cells. One per block of service, left to right.
 *
 * A terminated job freezes: the block it died on goes `--expired` and nothing
 * is drawn beyond it, because nothing beyond it was ever bought.
 */
export function buildStrip(state: MeterState, now: number): BlockCell[] {
  const snap = state.snapshot;
  if (!snap) return [];

  const paid = Math.max(snap.paidThrough, state.receipts.at(-1)?.blockIndex ?? 0);
  const current = snap.blockIndex;
  const terminal = state.terminated;
  const last = terminal ? terminal.finalBlockIndex : Math.max(paid, current);

  const boundaryAt = snap.boundaryAt ? Date.parse(snap.boundaryAt) : undefined;
  const blockMs = snap.blockSeconds * 1000;

  const cells: BlockCell[] = [];
  for (let index = 1; index <= Math.max(last, 1); index++) {
    let tone: BlockTone = "future";
    if (terminal && index === terminal.finalBlockIndex) tone = "expired";
    else if (index === current && !terminal) tone = "current";
    else if (index <= paid) tone = "settled";

    let fill = tone === "settled" || tone === "expired" ? 1 : 0;
    if (tone === "current" && boundaryAt !== undefined) {
      const elapsed = blockMs - (boundaryAt - now);
      fill = clamp(elapsed / blockMs, 0, 1);
    }

    cells.push({
      index,
      tone,
      fill,
      // Amber marks the block being *bought*, which is the one after the one
      // being served — that is what the renter has a decision about.
      windowOpen: !terminal && state.windowFor === index + 1 && index === current,
    });
  }

  return cells;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
