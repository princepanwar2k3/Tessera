/**
 * `tessera` — the renter's command line.
 *
 *   tessera machines                       what is for rent, and what it costs
 *   tessera rent --image X --blocks N      rent one, host something, watch it
 *
 * This process holds the renter's key. Nothing else does — not the browser,
 * not the marketplace.
 */
import { HederaPayer, Marketplace, type MachineRow } from "@bsp/sdk";

const FEE_PAYER = process.env["FACILITATOR_FEE_PAYER"] ?? "0.0.7162784";
const REGISTRY =
  process.env["REGISTRY_URL"] ?? process.env["CONTROL_PLANE_URL"] ?? "http://127.0.0.1:8090";
const CONSOLE_URL = process.env["CONSOLE_URL"] ?? "http://127.0.0.1:5175";
const ACCOUNT = process.env["PAYER_ID"] ?? process.env["HEDERA_OPERATOR_ID"] ?? "";
const KEY = process.env["PAYER_KEY"] ?? process.env["HEDERA_OPERATOR_KEY"] ?? "";
const TOKEN = process.env["HTS_SETTLEMENT_TOKEN_ID"];

const ESC = "\x1b[";
const dim = (s: string) => `${ESC}2m${s}${ESC}0m`;
const bold = (s: string) => `${ESC}1m${s}${ESC}0m`;
const green = (s: string) => `${ESC}32m${s}${ESC}0m`;
const amber = (s: string) => `${ESC}33m${s}${ESC}0m`;
const red = (s: string) => `${ESC}31m${s}${ESC}0m`;

function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function marketplace(): Marketplace {
  if (!ACCOUNT || !KEY) {
    throw new Error("Set PAYER_ID and PAYER_KEY (or run node with --env-file=.env).");
  }
  return new Marketplace({
    registryUrl: REGISTRY,
    renterUaid: `uaid:testnet:${ACCOUNT}`,
    payer: new HederaPayer({
      accountId: ACCOUNT,
      privateKey: KEY,
      network: "hedera:testnet",
      feePayer: FEE_PAYER,
      allowedAssets: ["0.0.0", ...(TOKEN ? [TOKEN] : [])],
      maxAmountPerPayment: "10000000",
    }),
  });
}

function shortAsset(asset: string): string {
  return asset === "HBAR" ? "HBAR" : asset === TOKEN ? "TESS" : asset;
}

/** What the renter can actually spend, so "can I afford this" is answerable. */
async function balanceOf(asset: string): Promise<number | undefined> {
  try {
    const base = "https://testnet.mirrornode.hedera.com/api/v1/accounts";
    if (asset === "HBAR") {
      const res = await fetch(`${base}/${ACCOUNT}`);
      return ((await res.json()) as { balance?: { balance: number } }).balance?.balance;
    }
    const res = await fetch(`${base}/${ACCOUNT}/tokens?token.id=${asset}`);
    const body = (await res.json()) as { tokens?: Array<{ balance: number }> };
    return body.tokens?.[0]?.balance;
  } catch {
    return undefined;
  }
}

/** Pad to visible width — ANSI escapes take space in the string but not on screen. */
function pad(text: string, width: number): string {
  // eslint-disable-next-line no-control-regex
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "").length;
  return text + " ".repeat(Math.max(0, width - visible));
}

function row(cells: string[], widths: number[]): string {
  return cells.map((c, i) => pad(c, widths[i] ?? 0)).join("  ");
}

async function listMachines(): Promise<void> {
  const machines: MachineRow[] = await marketplace().machines();
  if (machines.length === 0) {
    console.log("No machines online. Start a provider node to list one.");
    return;
  }

  const widths = [12, 8, 16, 9, 17, 8];
  console.log("");
  console.log(
    dim(row(["MACHINE", "BLOCK", "PRICE/BLOCK", "WINDOW", "HARDWARE", "STATUS"], widths)),
  );
  for (const m of machines) {
    console.log(
      row(
        [
          bold(m.machineId),
          `${m.params.blockSeconds}s`,
          `${m.params.pricePerBlock} ${shortAsset(m.params.asset)}`,
          `${m.params.leadSeconds}s`,
          `${m.specs.cpuCores} vCPU ${Math.round(m.specs.memoryMB / 1024)}GB`,
          m.live ? green("online") : dim("offline"),
        ],
        widths,
      ),
    );
  }

  const first = machines[0];
  if (first) {
    const held = await balanceOf(first.params.asset);
    const price = Number(first.params.pricePerBlock);
    console.log("");
    if (held !== undefined && price > 0) {
      const affordable = Math.floor(held / price);
      const minutes = Math.round((affordable * first.params.blockSeconds) / 6) / 10;
      console.log(
        `You hold ${bold(`${held} ${shortAsset(first.params.asset)}`)} — ` +
          `${bold(String(affordable))} blocks, about ${minutes} min on ${first.machineId}.`,
      );
    }
    console.log(
      dim(`Rent: tessera rent --machine ${first.machineId} --image <image> --blocks 10`),
    );
  }
  console.log("");
}

async function rent(): Promise<void> {
  const market = marketplace();
  const machines = await market.machines({ liveOnly: true });
  const wanted = flag("machine");
  const machine = wanted ? machines.find((m) => m.machineId === wanted) : machines[0];
  if (!machine) {
    throw new Error(wanted ? `No machine "${wanted}" is online.` : "No machines online.");
  }

  const image = flag("image", "tessera-demo-site:latest")!;
  const blocks = Number(flag("blocks", "10"));
  const port = Number(flag("port", "8080"));
  const price = BigInt(machine.params.pricePerBlock);
  const budget = (price * BigInt(blocks)).toString();
  const asset = shortAsset(machine.params.asset);

  console.log("");
  console.log(`  machine   ${bold(machine.machineId)}  (${machine.params.blockSeconds}s blocks)`);
  console.log(`  image     ${image}`);
  console.log(
    `  buying    ${bold(String(blocks))} blocks = ${blocks * machine.params.blockSeconds}s of uptime`,
  );
  console.log(`  spend cap ${bold(`${budget} ${asset}`)}`);

  const held = await balanceOf(machine.params.asset);
  if (held !== undefined) {
    const affordable = Math.floor(held / Number(price));
    console.log(`  you hold  ${held} ${asset} — enough for ${affordable} blocks`);
    if (affordable < blocks) {
      console.log("");
      console.log(amber(`  The cap is ${blocks} blocks but you can only pay for ${affordable}.`));
      console.log(amber(`  The site will go down when the money runs out, at block ${affordable}.`));
    }
  }
  console.log("");

  const job = await market.rent({
    machine: machine.machineId,
    image,
    exposedPort: port,
    budget,
    maxBlocks: blocks,
    fallbackIntervalMs: 500,
  });

  const t = () => dim(new Date().toISOString().slice(11, 19));
  job.on("block", (b) => console.log(`${t()}  ${green("paid")}    block ${b.index}  ${dim(b.txId)}`));
  job.on("renewal", (r) =>
    console.log(
      r.willPay
        ? `${t()}  ${amber("window")}  block ${r.index} — paying`
        : `${t()}  ${red("window")}  block ${r.index} — ${red(`declining: ${r.reason}`)}`,
    ),
  );
  job.on("error", (e) => console.log(`${t()}  ${red("error")}   ${e.message}`));

  // Give the container a moment to come up, so the URL is printable here.
  await new Promise((r) => setTimeout(r, 1800));
  const url = job.serviceUrl;
  console.log("");
  if (url) console.log(`  ${bold("Your site is live:")}  ${green(url)}`);
  console.log(`  ${bold("Watch it settle:")}    ${CONSOLE_URL}/#/job/${job.id}`);
  console.log(`  ${bold("Your dashboard:")}     ${CONSOLE_URL}/#/renter/${ACCOUNT}`);
  console.log("");

  const result = await job.result();

  console.log("");
  console.log(`  ended       ${red(result.reason)}`);
  console.log(`  blocks paid ${bold(String(result.blocksPaid))}`);
  console.log(`  spent       ${result.spent} ${asset}`);
  if (url) console.log(`  ${url} ${red("is no longer served")}`);
  const topic = process.env["HCS_RECEIPT_TOPIC_ID"];
  if (topic) {
    console.log("");
    console.log(dim(`  receipts: https://hashscan.io/testnet/topic/${topic}`));
  }
  console.log("");
}

const command = process.argv[2] ?? "machines";

try {
  if (command === "machines" || command === "ls") await listMachines();
  else if (command === "rent") await rent();
  else {
    console.log(
      "usage: tessera machines | tessera rent --machine <id> --image <image> --blocks <n>",
    );
    process.exit(1);
  }
} catch (err) {
  console.error(red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
}
