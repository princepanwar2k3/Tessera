import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(8080),
  host: z.string().default("0.0.0.0"),
  dataDir: z.string().default("./data"),
  dockerSocketPath: z.string().default("/var/run/docker.sock"),
  controlPlaneUrl: z.string().url().optional(),
  facilitatorMode: z.enum(["mock"]).default("mock"),
  receiptSink: z.enum(["local", "hcs", "local+hcs"]).default("local"),
  hcsTopicId: z.string().optional(),
  hederaNetwork: z.enum(["testnet", "mainnet"]).default("testnet"),
  hederaOperatorId: z.string().optional(),
  hederaOperatorKey: z.string().optional(),
  gracePeriodMs: z.coerce.number().int().positive().default(5000),
  watchdogIntervalMs: z.coerce.number().int().positive().default(1000),
  defaultBlockSeconds: z.coerce.number().int().positive().default(30),
  defaultLeadSeconds: z.coerce.number().int().positive().default(10),
  providerId: z.string().default("node-a"),
  providerUaid: z.string().default("uaid:local:node-a"),
  network: z.string().default("hedera-testnet"),
  payTo: z.string().default("0.0.PROVIDER"),
});

const Config = ConfigSchema.superRefine((c, ctx) => {
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
    receiptSink: env.RECEIPT_SINK,
    hcsTopicId: env.HCS_RECEIPT_TOPIC_ID || undefined,
    hederaNetwork: env.HEDERA_NETWORK,
    hederaOperatorId: env.HEDERA_OPERATOR_ID || undefined,
    hederaOperatorKey: env.HEDERA_OPERATOR_KEY || undefined,
    gracePeriodMs: env.GRACE_PERIOD_MS,
    watchdogIntervalMs: env.WATCHDOG_INTERVAL_MS,
    defaultBlockSeconds: env.DEFAULT_BLOCK_SECONDS,
    defaultLeadSeconds: env.DEFAULT_LEAD_SECONDS,
    providerId: env.PROVIDER_ID,
    providerUaid: env.PROVIDER_UAID,
    network: env.NETWORK,
    payTo: env.PAY_TO,
  });
}
