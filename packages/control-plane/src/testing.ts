/**
 * Embeddable control plane, for `tools/e2e`.
 *
 * `src/index.ts` is the process entry point. This assembles the same graph
 * against an in-memory database and an ephemeral port, so a test can start
 * and — importantly — *kill* a real control plane mid-job.
 */
import { openDatabase } from "./db.js";
import { Registry } from "./registry.js";
import { Broker } from "./broker.js";
import { ReceiptReader } from "./receipts.js";
import { buildServer } from "./server.js";

export interface TestControlPlane {
  url: string;
  registry: Registry;
  broker: Broker;
  close: () => Promise<void>;
}

export async function startTestControlPlane(
  opts: { dbPath?: string; hcsTopicId?: string } = {},
): Promise<TestControlPlane> {
  const db = openDatabase(opts.dbPath ?? ":memory:");
  const registry = new Registry(db);
  const broker = new Broker(db, registry);
  const receipts = new ReceiptReader(opts.hcsTopicId);

  const app = buildServer({ registry, broker, receipts });
  await app.listen({ port: 0, host: "127.0.0.1" });

  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    registry,
    broker,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

export { Registry, Broker, ReceiptReader, openDatabase, buildServer };
