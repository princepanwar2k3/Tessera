import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(8091),
  /** Loopback by default: this process holds a key. */
  host: z.string().default("127.0.0.1"),
  registryUrl: z.string().url().default("http://127.0.0.1:8090"),
  accountId: z.string().min(1),
  privateKey: z.string().min(1),
  feePayer: z.string().default("0.0.7162784"),
  network: z.enum(["hedera:testnet", "hedera:mainnet"]).default("hedera:testnet"),
  /** HBAR plus any HTS token this renter is willing to be charged in. */
  settlementToken: z.string().optional(),
  maxAmountPerPayment: z.string().default("10000000"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    port: env.RENTER_PORT,
    host: env.RENTER_HOST,
    registryUrl: env.REGISTRY_URL ?? env.CONTROL_PLANE_URL,
    accountId: env.PAYER_ID ?? env.HEDERA_OPERATOR_ID,
    privateKey: env.PAYER_KEY ?? env.HEDERA_OPERATOR_KEY,
    feePayer: env.FACILITATOR_FEE_PAYER,
    network: env.RENTER_NETWORK,
    settlementToken: env.HTS_SETTLEMENT_TOKEN_ID || undefined,
    maxAmountPerPayment: env.RENTER_MAX_PER_PAYMENT,
  });
}
