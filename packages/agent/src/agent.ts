import { Marketplace, type Job, type JobResult, type MachineRow } from "@bsp/sdk";
import { selectMachine, type Selection, type WorkloadNeeds } from "./selection.js";

export interface WorkloadSpec extends WorkloadNeeds {
  image: string;
  cmd?: string[];
  env?: Record<string, string>;
  /** What one run of this workload produces — the denominator of cost/unit. */
  unitsOfWork?: number;
  unitLabel?: string;
}

export interface AgentReport {
  selection: Selection;
  result: JobResult;
  /** Actual spend divided by units of work produced. */
  costPerUnit: number;
  unitLabel: string;
  /** What the selection predicted, against what was actually paid. */
  estimatedCost: string;
  actualCost: string;
  blocksEstimated: number;
  blocksPaid: number;
}

export interface AgentOptions {
  marketplace: Marketplace;
  log?: (line: string) => void;
  /** Renewal timer fallback interval, forwarded to the SDK. */
  fallbackIntervalMs?: number;
}

/**
 * An agent that rents a machine unattended.
 *
 * It compares listings on price *and* block size (PLAN.md Phase 5), prints the
 * reasoning, runs the job through the SDK, and reports what the work actually
 * cost per unit. The estimate and the outcome are both reported, because the
 * gap between them is what block size actually costs.
 */
export class RentingAgent {
  private readonly log: (line: string) => void;

  constructor(private readonly opts: AgentOptions) {
    this.log = opts.log ?? ((line) => console.log(line));
  }

  /** Discovery, quoting and the decision — without renting anything. */
  async plan(workload: WorkloadSpec): Promise<{ selection: Selection; machines: MachineRow[] }> {
    const machines = await this.opts.marketplace.machines();
    const selection = selectMachine(machines, workload);
    for (const line of selection.reasoning) this.log(line);
    return { selection, machines };
  }

  async run(workload: WorkloadSpec): Promise<AgentReport> {
    const { selection } = await this.plan(workload);
    const chosen = selection.chosen;
    if (!chosen) {
      throw new Error("no machine satisfies the workload within budget");
    }

    const job: Job = await this.opts.marketplace.rent({
      machine: chosen.machineId,
      image: workload.image,
      ...(workload.cmd ? { cmd: workload.cmd } : {}),
      ...(workload.env ? { env: workload.env } : {}),
      budget: workload.budget,
      maxBlocks: chosen.blocksNeeded,
      ...(this.opts.fallbackIntervalMs !== undefined
        ? { fallbackIntervalMs: this.opts.fallbackIntervalMs }
        : {}),
    });

    this.log(`Renting ${chosen.machineId} — job ${job.id}`);
    job.on("block", (b) => this.log(`  block ${b.index} settled  ${b.txId}`));
    job.on("renewal", (r) => {
      if (!r.willPay) this.log(`  declining block ${r.index}: ${r.reason}`);
    });

    const result = await job.result();

    const units = workload.unitsOfWork ?? 1;
    const unitLabel = workload.unitLabel ?? "run";
    const costPerUnit = Number(result.spent) / units;

    this.log(
      `Ended: ${result.reason} after ${result.blocksPaid} blocks, spent ${result.spent}` +
        ` (estimated ${chosen.totalCost} over ${chosen.blocksNeeded}).`,
    );
    this.log(`Cost per ${unitLabel}: ${costPerUnit.toFixed(2)}`);

    return {
      selection,
      result,
      costPerUnit,
      unitLabel,
      estimatedCost: chosen.totalCost,
      actualCost: result.spent,
      blocksEstimated: chosen.blocksNeeded,
      blocksPaid: result.blocksPaid,
    };
  }
}
