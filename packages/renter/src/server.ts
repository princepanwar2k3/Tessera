import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { Renter } from "./renter.js";

const RentBody = z.object({
  machineId: z.string().min(1),
  image: z.string().min(1),
  blocks: z.number().int().min(1).max(500),
  exposedPort: z.number().int().min(1).max(65535).optional(),
  cmd: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

/**
 * Local HTTP surface for the renter's own agent.
 *
 * Binds to loopback by default and is meant to be reached only by the
 * console running on the same machine. It is the renter's wallet, not a
 * service: nothing here should ever be exposed to a network.
 */
export function buildServer(renter: Renter): FastifyInstance {
  const app = Fastify({ logger: false });

  app.addHook("onRequest", async (_req, reply) => {
    void reply.header("access-control-allow-origin", "*");
    void reply.header("access-control-allow-headers", "content-type");
    void reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
  });
  app.options("/*", async (_req, reply) => reply.status(204).send());

  /** What the console shows as "connected as …". */
  app.get("/whoami", async () => ({
    accountId: renter.accountId,
    connected: true,
  }));

  app.get("/jobs", async () => ({ jobs: renter.list() }));

  app.get<{ Params: { jobId: string } }>("/jobs/:jobId", async (req, reply) => {
    const job = renter.get(req.params.jobId);
    if (!job) return reply.status(404).send({ error: "not_renting_that_job" });
    return job;
  });

  app.get<{ Querystring: { machine?: string; blocks?: string } }>(
    "/quote",
    async (req, reply) => {
      const blocks = Number(req.query.blocks ?? 4);
      if (!req.query.machine || !Number.isInteger(blocks) || blocks < 1) {
        return reply.status(400).send({ error: "machine and blocks are required" });
      }
      const quote = await renter.quote(req.query.machine, blocks);
      if (!quote) return reply.status(404).send({ error: "machine_not_listed" });
      return quote;
    },
  );

  app.post("/rent", async (req, reply) => {
    const parsed = RentBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    try {
      return await renter.rent(parsed.data);
    } catch (err) {
      // Placement and the first settlement happen here, so this is where a
      // renter finds out their account can't pay. Say which.
      return reply.status(502).send({
        error: "rent_failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post<{ Params: { jobId: string } }>("/jobs/:jobId/stop", async (req, reply) => {
    const job = renter.stopRenewing(req.params.jobId);
    if (!job) return reply.status(404).send({ error: "not_renting_that_job" });
    return job;
  });

  return app;
}
