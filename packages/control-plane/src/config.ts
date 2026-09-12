import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(8090),
  host: z.string().default("0.0.0.0"),
  dbPath: z.string().default("./data/control-plane.db"),
  /** Shared HCS receipt topic; without it /receipts answers 503 rather than lying. */
  hcsTopicId: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    port: env.CONTROL_PLANE_PORT ?? env.PORT,
    host: env.HOST,
    dbPath: env.CONTROL_PLANE_DB,
    hcsTopicId: env.HCS_RECEIPT_TOPIC_ID || undefined,
  });
}
