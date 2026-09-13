/**
 * `tessera-node` — the provider's command line.
 *
 *   tessera-node list --block-seconds 15 --lead 10 --price 25 --asset TESS
 *
 * Starts a provider daemon and advertises it. A thin wrapper over the same
 * environment the daemon already reads: the point is that listing a machine
 * reads as one decision — what to sell and at what granularity — rather than
 * a screen of configuration.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const ESC = "\x1b[";
const dim = (s: string) => `${ESC}2m${s}${ESC}0m`;
const bold = (s: string) => `${ESC}1m${s}${ESC}0m`;
const green = (s: string) => `${ESC}32m${s}${ESC}0m`;
const red = (s: string) => `${ESC}31m${s}${ESC}0m`;

function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const blockSeconds = Number(flag("block-seconds", "15"));
const leadSeconds = Number(flag("lead", "10"));
const price = flag("price", "25")!;
const assetFlag = flag("asset", "HBAR")!;
const providerId = flag("name", "node-a")!;
const port = flag("port", "8080")!;
const registry = flag("registry", process.env["CONTROL_PLANE_URL"] ?? "http://127.0.0.1:8090")!;

// "TESS" is a convenience for the configured settlement token.
const asset =
  assetFlag.toUpperCase() === "TESS" && process.env["HTS_SETTLEMENT_TOKEN_ID"]
    ? process.env["HTS_SETTLEMENT_TOKEN_ID"]
    : assetFlag;

/** SPEC §4.1, checked here so a bad listing fails before anything starts. */
const floor = Math.max(4, Math.ceil(0.3 * blockSeconds));
if (!Number.isInteger(blockSeconds) || blockSeconds < 5 || blockSeconds > 3600) {
  console.error(red(`block-seconds must be between 5 and 3600 (got ${blockSeconds})`));
  process.exit(1);
}
if (leadSeconds < floor || leadSeconds >= blockSeconds) {
  console.error(
    red(
      `lead must be at least ${floor}s and less than the block (${blockSeconds}s) — got ${leadSeconds}s`,
    ),
  );
  console.error(dim("A window no renter could pay inside would make the protocol look broken."));
  process.exit(1);
}

console.log("");
console.log(`  Listing ${bold(providerId)}`);
console.log(`    block size      ${bold(`${blockSeconds}s`)}   ${dim("what a renter buys at a time")}`);
console.log(`    renewal window  ${bold(`${leadSeconds}s`)}   ${dim("how long they have to buy the next one")}`);
console.log(`    price           ${bold(`${price} ${assetFlag}`)}  ${dim("per block")}`);
console.log(`    paid to         ${process.env["PAY_TO"] ?? dim("(set PAY_TO)")}`);
console.log(`    registry        ${registry}`);
console.log("");

// Resolve through the package manifest rather than the package entry: the
// daemon's "." export points at its test harness, and its program entry is
// not meant to be imported — only spawned.
const require = createRequire(import.meta.url);
const daemonEntry = resolve(
  dirname(require.resolve("@bsp/daemon/package.json")),
  "dist/index.js",
);

const child = spawn(process.execPath, [daemonEntry], {
  env: {
    ...process.env,
    PORT: port,
    PROVIDER_ID: providerId,
    DEFAULT_BLOCK_SECONDS: String(blockSeconds),
    DEFAULT_LEAD_SECONDS: String(leadSeconds),
    PRICE_PER_BLOCK: price,
    ASSET: asset,
    CONTROL_PLANE_URL: registry,
  },
  stdio: ["inherit", "pipe", "inherit"],
});

let announced = false;
child.stdout.on("data", (chunk: Buffer) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (!announced && /registered with control plane|daemon listening/.test(text)) {
    announced = true;
    console.log("");
    console.log(`  ${green("Listed.")} Renters can now find it with ${bold("tessera machines")}.`);
    console.log("");
  }
});

child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
