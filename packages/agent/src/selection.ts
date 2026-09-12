import type { MachineRow } from "@bsp/sdk";
import { compareAmounts, multiplyAmount } from "@bsp/sdk";

export interface WorkloadNeeds {
  /** Expected runtime in seconds. Drives how many blocks must be bought. */
  seconds: number;
  minCpuCores?: number;
  minMemoryMB?: number;
  /** Total the agent may spend, smallest units. */
  budget: string;
}

export interface Quote {
  machineId: string;
  blockSeconds: number;
  pricePerBlock: string;
  /** Blocks needed to cover the workload — the final one is billed whole. */
  blocksNeeded: number;
  /** blocksNeeded * pricePerBlock. */
  totalCost: string;
  /** Seconds bought but not used, forfeited under SPEC §5.6. */
  wastedSeconds: number;
  /** Cost per second of *useful* work, for the cost-per-unit report. */
  costPerSecond: number;
}

export interface Rejection {
  machineId: string;
  reason: string;
}

export interface Selection {
  chosen?: Quote | undefined;
  quotes: Quote[];
  rejected: Rejection[];
  /** Human-readable decision trace. A visible decision beats an invisible one. */
  reasoning: string[];
}

/**
 * Quote one machine for a workload.
 *
 * The whole point: cost is `ceil(seconds / blockSeconds) * pricePerBlock`, not
 * a rate. Block size is therefore part of the price, because the last block is
 * billed whole whether or not it is used (SPEC §5.6). A cheaper node with 60s
 * blocks really can cost more for a 90s job than a dearer node with 15s ones.
 */
export function quote(machine: MachineRow, seconds: number): Quote {
  const blockSeconds = machine.params.blockSeconds;
  const blocksNeeded = Math.max(1, Math.ceil(seconds / blockSeconds));
  const totalCost = multiplyAmount(machine.params.pricePerBlock, blocksNeeded);

  return {
    machineId: machine.machineId,
    blockSeconds,
    pricePerBlock: machine.params.pricePerBlock,
    blocksNeeded,
    totalCost,
    wastedSeconds: blocksNeeded * blockSeconds - seconds,
    costPerSecond: Number(totalCost) / seconds,
  };
}

/**
 * Pick a machine for a workload, and say why.
 *
 * Ranking is by total cost for *this* workload, with block size as the
 * tie-breaker — at equal cost, finer granularity means less forfeited time if
 * the job ends early and a smaller maximum loss under I2.
 */
/** Price per second of block time — the rate, before any forfeiture. */
function rate(q: Quote): number {
  return Number(q.pricePerBlock) / q.blockSeconds;
}

function fmt(n: number): string {
  return n.toFixed(2).replace(/\.00$/, "");
}

export function selectMachine(machines: MachineRow[], needs: WorkloadNeeds): Selection {
  const reasoning: string[] = [];
  const rejected: Rejection[] = [];
  const quotes: Quote[] = [];

  reasoning.push(
    `Workload: ~${needs.seconds}s, budget ${needs.budget}` +
      (needs.minCpuCores ? `, >=${needs.minCpuCores} cores` : "") +
      (needs.minMemoryMB ? `, >=${needs.minMemoryMB} MB` : ""),
  );

  for (const machine of machines) {
    if (!machine.live) {
      rejected.push({ machineId: machine.machineId, reason: "offline" });
      continue;
    }
    if (needs.minCpuCores !== undefined && machine.specs.cpuCores < needs.minCpuCores) {
      rejected.push({
        machineId: machine.machineId,
        reason: `${machine.specs.cpuCores} cores < ${needs.minCpuCores} required`,
      });
      continue;
    }
    if (needs.minMemoryMB !== undefined && machine.specs.memoryMB < needs.minMemoryMB) {
      rejected.push({
        machineId: machine.machineId,
        reason: `${machine.specs.memoryMB} MB < ${needs.minMemoryMB} MB required`,
      });
      continue;
    }

    const q = quote(machine, needs.seconds);
    if (compareAmounts(q.totalCost, needs.budget) > 0) {
      rejected.push({
        machineId: machine.machineId,
        reason: `${q.totalCost} over budget ${needs.budget}`,
      });
      continue;
    }
    quotes.push(q);
  }

  for (const q of quotes) {
    reasoning.push(
      `${q.machineId}: ${q.blockSeconds}s blocks @ ${q.pricePerBlock} → ` +
        `${q.blocksNeeded} blocks = ${q.totalCost} (${q.wastedSeconds}s forfeited)`,
    );
  }
  for (const r of rejected) {
    reasoning.push(`${r.machineId}: rejected — ${r.reason}`);
  }

  // Cheapest for this workload; finer blocks win a tie (smaller I2 exposure).
  const ranked = [...quotes].sort((a, b) => {
    const byCost = compareAmounts(a.totalCost, b.totalCost);
    if (byCost !== 0) return byCost;
    return a.blockSeconds - b.blockSeconds;
  });

  const chosen = ranked[0];
  if (!chosen) {
    reasoning.push("No machine satisfies the workload within budget.");
    return { quotes, rejected, reasoning };
  }

  reasoning.push(`Chose ${chosen.machineId}: ${chosen.totalCost} total.`);

  const runnerUp = ranked[1];
  if (runnerUp && compareAmounts(runnerUp.totalCost, chosen.totalCost) !== 0) {
    // The sentence the whole granularity argument rests on. The comparison
    // that matters is price per *second of block time*, not price per block:
    // a node can be the cheaper rate and still cost more, because the last
    // block is billed whole (SPEC §5.6).
    const runnerUpRate = rate(runnerUp);
    const chosenRate = rate(chosen);
    reasoning.push(
      runnerUpRate < chosenRate
        ? `Runner-up: ${runnerUp.machineId} is the cheaper rate ` +
            `(${fmt(runnerUpRate)} vs ${fmt(chosenRate)} per block-second) but its ` +
            `${runnerUp.blockSeconds}s blocks forfeit ${runnerUp.wastedSeconds}s, ` +
            `costing ${runnerUp.totalCost} overall.`
        : `Runner-up: ${runnerUp.machineId} would cost ${runnerUp.totalCost}.`,
    );
  }

  return { chosen, quotes, rejected, reasoning };
}
