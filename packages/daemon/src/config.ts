import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(8080),
  host: z.string().default("0.0.0.0"),
  dataDir: z.string().default("./data"),
  dockerSocketPath: z.string().default("/var/run/docker.sock"),
  controlPlaneUrl: z.string().url().optional(),
  facilitatorMode: z.enum(["mock"]).default("mock"),
  receiptSink: z.enum(["local"]).default("local"),
  gracePeriodMs: z.coerce.number().int().positive().default(5000),
  watchdogIntervalMs: z.coerce.number().int().positive().default(1000),
  defaultBlockSeconds: z.coerce.number().int().positive().default(30),
  defaultLeadSeconds: z.coerce.number().int().positive().default(10),
  providerId: z.string().default("node-a"),
  providerUaid: z.string().default("uaid:local:node-a"),
  network: z.string().default("hedera-testnet"),
  payTo: z.string().default("0.0.PROVIDER"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    port: env.PORT,
    host: env.HOST,
    dataDir: env.DATA_DIR,
    dockerSocketPath: env.DOCKER_SOCKET_PATH,
    controlPlaneUrl: env.CONTROL_PLANE_URL || undefined,
    facilitatorMode: env.FACILITATOR_MODE,
    receiptSink: env.RECEIPT_SINK,
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
