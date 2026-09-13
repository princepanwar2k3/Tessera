import { z } from "zod";
import { resolve } from "node:path";

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(8080),
  host: z.string().default("0.0.0.0"),
  // Resolved here so every consumer gets an absolute path; a bind mount
  // source that is merely relative is silently a volume name to Docker.
  dataDir: z.string().default("./data").transform((d) => resolve(d)),
  dockerSocketPath: z.string().default("/var/run/docker.sock"),
  controlPlaneUrl: z.string().url().optional(),
  facilitatorMode: z.enum(["mock", "blocky402"]).default("mock"),
  facilitatorUrl: z.string().url().default("https://api.testnet.blocky402.com"),
  /** The facilitator's advertised fee payer, from GET /supported. */
  facilitatorFeePayer: z.string().optional(),
  receiptSink: z.enum(["local", "hcs", "local+hcs"]).default("local"),
  hcsTopicId: z.string().optional(),
  hederaNetwork: z.enum(["testnet", "mainnet"]).default("testnet"),
  hederaOperatorId: z.string().optional(),
  hederaOperatorKey: z.string().optional(),
  /**
   * Hardening for renter-supplied containers. Leave on unless this host
   * refuses to exec under it — see docs in container-config.ts.
   */
  noNewPrivileges: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  gracePeriodMs: z.coerce.number().int().positive().default(5000),
  watchdogIntervalMs: z.coerce.number().int().positive().default(1000),
  defaultBlockSeconds: z.coerce.number().int().positive().default(30),
  defaultLeadSeconds: z.coerce.number().int().positive().default(10),
  providerId: z.string().default("node-a"),
  /** Base URL renters reach this daemon on — what the listing advertises. */
  publicUrl: z.string().url().optional(),
  /** Host renters reach published workloads on (the rented site's hostname). */
  publicHost: z.string().default("127.0.0.1"),
  /** Advertised price per block, smallest unit, decimal string (SPEC §4). */
  pricePerBlock: z.string().default("1500"),
  /** Settlement asset: a token id ("0.0.XXXXXX") or "HBAR". */
  asset: z.string().default("HBAR"),
  providerUaid: z.string().default("uaid:local:node-a"),
  network: z.string().default("hedera-testnet"),
  payTo: z.string().default("0.0.PROVIDER"),
});

const Config = ConfigSchema.superRefine((c, ctx) => {
  // Every Hedera requirement must carry the facilitator's advertised fee
  // payer, which co-signs and submits the transfer. Without it nothing can
  // settle, so refuse to boot rather than fail at the first payment.
  if (c.facilitatorMode === "blocky402" && c.facilitatorFeePayer === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'facilitatorMode "blocky402" requires FACILITATOR_FEE_PAYER (see GET /supported)',
    });
  }

  if (c.receiptSink === "local") return;
  // A provider that thinks it is publishing receipts and is not is worse than
  // one that never claimed to: the audit log SPEC §8 relies on would be
  // quietly empty. Fail at boot instead.
  if (c.hcsTopicId === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `receiptSink "${c.receiptSink}" requires HCS_RECEIPT_TOPIC_ID`,
    });
  }
  if (c.hederaOperatorId === undefined || c.hederaOperatorKey === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `receiptSink "${c.receiptSink}" requires HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY`,
    });
  }
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Config.parse({
    port: env.PORT,
    host: env.HOST,
    dataDir: env.DATA_DIR,
    dockerSocketPath: env.DOCKER_SOCKET_PATH,
    controlPlaneUrl: env.CONTROL_PLANE_URL || undefined,
    facilitatorMode: env.FACILITATOR_MODE,
    facilitatorUrl: env.FACILITATOR_URL,
    facilitatorFeePayer: env.FACILITATOR_FEE_PAYER || undefined,
    receiptSink: env.RECEIPT_SINK,
    hcsTopicId: env.HCS_RECEIPT_TOPIC_ID || undefined,
    hederaNetwork: env.HEDERA_NETWORK,
    hederaOperatorId: env.HEDERA_OPERATOR_ID || undefined,
    hederaOperatorKey: env.HEDERA_OPERATOR_KEY || undefined,
    noNewPrivileges: env.NO_NEW_PRIVILEGES,
    gracePeriodMs: env.GRACE_PERIOD_MS,
    watchdogIntervalMs: env.WATCHDOG_INTERVAL_MS,
    defaultBlockSeconds: env.DEFAULT_BLOCK_SECONDS,
    defaultLeadSeconds: env.DEFAULT_LEAD_SECONDS,
    providerId: env.PROVIDER_ID,
    publicUrl: env.PUBLIC_URL || undefined,
    publicHost: env.PUBLIC_HOST,
    pricePerBlock: env.PRICE_PER_BLOCK,
    asset: env.ASSET,
    providerUaid: env.PROVIDER_UAID,
    network: env.NETWORK,
    payTo: env.PAY_TO,
  });
}
