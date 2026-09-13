import { addAmounts, compareAmounts } from "./amounts.js";

export interface BudgetState {
  /** Total already settled, smallest units. */
  spent: string;
  /** Cap the renter set. Never exceeded, not even by one block. */
  budget: string;
  /** Blocks settled so far. */
  blocksPaid: number;
  /** Ceiling on blocks, or undefined for "until the budget runs out". */
  maxBlocks?: number | undefined;
  /** Price of the block being offered. */
  pricePerBlock: string;
}

export type RenewalDecision =
  | { pay: true }
  | { pay: false; reason: "budget_exhausted" | "max_blocks_reached" | "stopped_by_renter" };

/**
 * Should the renter buy the next block?
 *
 * Pure, and deliberately the whole of the kill switch. Declining is *not* a
 * special case: the renter simply does nothing, and the provider's watchdog
 * ends the job at the boundary. There is no "cancel"
 * message to send and no cleanup handshake to get wrong (SPEC §7, "renter
 * disappears").
 */
export function decideRenewal(state: BudgetState, stopped = false): RenewalDecision {
  if (stopped) return { pay: false, reason: "stopped_by_renter" };

  if (state.maxBlocks !== undefined && state.blocksPaid >= state.maxBlocks) {
    return { pay: false, reason: "max_blocks_reached" };
  }

  // Checked against the *projected* total, not the current one: a renter who
  // set a cap of 2 HBAR must never be billed 2.1 and told afterwards.
  const projected = addAmounts(state.spent, state.pricePerBlock);
  if (compareAmounts(projected, state.budget) > 0) {
    return { pay: false, reason: "budget_exhausted" };
  }

  return { pay: true };
}

/** How many more blocks this budget affords, for progress display. */
export function blocksAffordable(state: BudgetState): number {
  const remaining = BigInt(state.budget) - BigInt(state.spent);
  const price = BigInt(state.pricePerBlock);
  if (price <= 0n || remaining < 0n) return 0;
  const byBudget = Number(remaining / price);
  if (state.maxBlocks === undefined) return byBudget;
  return Math.max(0, Math.min(byBudget, state.maxBlocks - state.blocksPaid));
}
