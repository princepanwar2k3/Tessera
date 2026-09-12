import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { Registry } from "./registry.js";
import type { Broker } from "./broker.js";
import type { ReceiptReader } from "./receipts.js";
import { proxyJobEvents } from "./mirror.js";

const MachineListingBody = z
  .object({
    machineId: z.string(),
    providerId: z.string(),
    endpoint: z.string(),
    specs: z.record(z.unknown()),
    params: z.record(z.unknown()),
    benchmark: z.record(z.unknown()),
  })
  .passthrough();

const RegisterBody = z.object({
  providerId: z.string().min(1),
  endpoint: z.string().url(),
  machines: z.array(MachineListingBody).min(1),
});

const PlaceJobBody = z.object({
  machineId: z.string().min(1),
  renterUaid: z.string().min(1),
  image: z.string().min(1),
  cmd: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

export interface ServerDeps {
  registry: Registry;
  broker: Broker;
  receipts: ReceiptReader;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  // The console is served from a different origin (Vercel) than this process.
  app.addHook("onRequest", async (_req, reply) => {
    void reply.header("access-control-allow-origin", "*");
    void reply.header("access-control-allow-headers", "content-type, last-event-id");
    void reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
  });
  app.options("/*", async (_req, reply) => reply.status(204).send());

  app.get("/healthz", async () => ({
    status: "ok",
    machines: deps.registry.listMachines().length,
    receiptsConfigured: deps.receipts.configured,
  }));

  // --- registry -----------------------------------------------------------

  app.post("/providers", async (req, reply) => {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const result = deps.registry.register(parsed.data as never);
    if (!result.ok) {
      // SPEC §4.1: a listing whose renewal window no renter could pay inside
      // is refused at registration, not discovered at the first boundary.
      return reply.status(400).send({ error: "invalid_listing", issues: result.issues });
    }
    return reply.status(201).send(result);
  });

  app.post<{ Params: { providerId: string } }>(
    "/providers/:providerId/heartbeat",
    async (req, reply) => {
      const known = deps.registry.heartbeat(req.params.providerId);
      if (!known) return reply.status(404).send({ error: "provider_not_registered" });
      return reply.send({ ok: true, at: new Date().toISOString() });
    },
  );

  app.get<{ Querystring: { live?: string } }>("/machines", async (req, reply) => {
    const liveOnly = req.query.live === "true";
    return reply.send({ machines: deps.registry.listMachines({ liveOnly }) });
  });

  // --- placement ----------------------------------------------------------

  app.post("/jobs", async (req, reply) => {
    const parsed = PlaceJobBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const result = await deps.broker.place(parsed.data);
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error, detail: result.detail });
    }
    // 402, matching the daemon: the renter's next step is to pay, and the
    // body they need to pay against is the daemon's own, passed through.
    return reply.status(402).send({
      ...result.placement,
      payTo: `${result.placement.endpoint.replace(/\/$/, "")}/jobs/${result.placement.jobId}`,
      requirement: result.requirement,
    });
  });

  app.get("/jobs", async (_req, reply) => reply.send({ jobs: deps.broker.listPlacements() }));

  app.get<{ Params: { jobId: string } }>("/jobs/:jobId", async (req, reply) => {
    const placement = deps.broker.getPlacement(req.params.jobId);
    if (!placement) return reply.status(404).send({ error: "job_not_placed" });
    return reply.send(placement);
  });

  // --- mirrors ------------------------------------------------------------

  app.get<{ Params: { jobId: string } }>("/jobs/:jobId/events", (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
      "x-accel-buffering": "no",
    });

    const started = proxyJobEvents(
      deps.broker,
      req.params.jobId,
      (chunk) => {
        if (!reply.raw.writableEnded) reply.raw.write(chunk);
      },
      { lastEventId: headerValue(req.headers["last-event-id"]) },
    );

    if (!started.ok) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: started.error })}\n\n`);
      reply.raw.end();
      return;
    }

    const cleanup = () => started.handle.close();
    req.raw.on("close", cleanup);
    reply.raw.on("close", cleanup);
  });

  app.get<{ Querystring: { job?: string; limit?: string } }>("/receipts", async (req, reply) => {
    if (!deps.receipts.configured) {
      return reply.status(503).send({ error: "receipts_not_configured" });
    }
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const receipts = await deps.receipts.read({ jobId: req.query.job, limit });
      return reply.send({ receipts });
    } catch (err) {
      // An unreachable mirror node and an empty history mean opposite things
      // to a renter auditing a job. Never let one look like the other.
      return reply.status(502).send({
        error: "mirror_node_unavailable",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return app;
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
