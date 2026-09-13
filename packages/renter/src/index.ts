import { loadConfig } from "./config.js";
import { Renter } from "./renter.js";
import { buildServer } from "./server.js";

async function main() {
  const config = loadConfig();

  const renter = new Renter({
    registryUrl: config.registryUrl,
    accountId: config.accountId,
    privateKey: config.privateKey,
    feePayer: config.feePayer,
    network: config.network,
    allowedAssets: ["0.0.0", ...(config.settlementToken ? [config.settlementToken] : [])],
    maxAmountPerPayment: config.maxAmountPerPayment,
  });

  const app = buildServer(renter);
  await app.listen({ port: config.port, host: config.host });

  console.log(
    JSON.stringify({
      msg: "renter agent listening — holds your key, nothing else does",
      port: config.port,
      account: config.accountId,
      registry: config.registryUrl,
      settlementToken: config.settlementToken ?? null,
    }),
  );

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
