import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { Registry } from "./registry.js";
import { Broker } from "./broker.js";
import { ReceiptReader } from "./receipts.js";
import { buildServer } from "./server.js";

async function main() {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const registry = new Registry(db);
  const broker = new Broker(db, registry);
  const receipts = new ReceiptReader(config.hcsTopicId);

  const app = buildServer({ registry, broker, receipts });
  await app.listen({ port: config.port, host: config.host });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      msg: "control plane listening",
      port: config.port,
      db: config.dbPath,
      receiptTopic: config.hcsTopicId ?? null,
    }),
  );

  const shutdown = async () => {
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
