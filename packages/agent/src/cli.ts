/**
 * The unattended agent, as a command.
 *
 *   pnpm -F @bsp/agent demo -- --seconds 25 --budget 9000
 *
 * Discovers what is listed, quotes each machine for the workload, prints the
 * reasoning, rents the one that costs least overall, and reports what the work
 * actually cost. Everything after placement goes straight to the provider.
 */
import { Marketplace } from "@bsp/sdk";
import { RentingAgent } from "./agent.js";

interface Args {
  registry: string;
  image: string;
  seconds: number;
  budget: string;
  units: number;
  unitLabel: string;
  minCpuCores?: number;
  minMemoryMB?: number;
  planOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(`--${flag}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const minCpuCores = get("min-cores");
  const minMemoryMB = get("min-memory-mb");

  return {
    registry: get("registry") ?? process.env["CONTROL_PLANE_URL"] ?? "http://127.0.0.1:8090",
    image: get("image") ?? "busybox:latest",
    seconds: Number(get("seconds") ?? 25),
    budget: get("budget") ?? "9000",
    units: Number(get("units") ?? 1),
    unitLabel: get("unit-label") ?? "run",
    ...(minCpuCores !== undefined ? { minCpuCores: Number(minCpuCores) } : {}),
    ...(minMemoryMB !== undefined ? { minMemoryMB: Number(minMemoryMB) } : {}),
    planOnly: argv.includes("--plan-only"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const agent = new RentingAgent({
    marketplace: new Marketplace({
      registryUrl: args.registry,
      renterUaid: "uaid:demo:agent",
    }),
    fallbackIntervalMs: 250,
  });

  const workload = {
    image: args.image,
    // A container that keeps working until the provider stops it, so the job
    // ends at a boundary rather than by finishing early.
    cmd: ["sh", "-c", "i=0; while true; do echo work $i; i=$((i+1)); sleep 1; done"],
    seconds: args.seconds,
    budget: args.budget,
    unitsOfWork: args.units,
    unitLabel: args.unitLabel,
    ...(args.minCpuCores !== undefined ? { minCpuCores: args.minCpuCores } : {}),
    ...(args.minMemoryMB !== undefined ? { minMemoryMB: args.minMemoryMB } : {}),
  };

  if (args.planOnly) {
    await agent.plan(workload);
    return;
  }

  const report = await agent.run(workload);
  console.log("");
  console.log("Receipts:");
  for (const receipt of report.result.receipts) {
    console.log(`  block ${receipt.blockIndex}  ${receipt.txId}  ${receipt.amount}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
