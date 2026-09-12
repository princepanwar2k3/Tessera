import type { FastifyInstance, FastifyReply } from "fastify";
import type { JobService } from "../jobs/job-service.js";
import type { JobEventBus, SequencedJobEvent } from "../events/job-events.js";

/** Comment frame every 15s so proxies don't reap an idle stream. */
const KEEPALIVE_MS = 15_000;

/**
 * `GET /jobs/:jobId/events` — SPEC §5.3's renewal challenge stream, and the
 * feed the console's meter runs on.
 *
 * A hint, never a dependency (PLAN.md): everything delivered here is also
 * reachable by polling the 402 on the block resource, so a dropped stream
 * can never kill a paid job. Reconnection is honest — `Last-Event-ID` replays
 * exactly what was missed from the bus's ring buffer.
 */
export function registerEventsRoute(
  app: FastifyInstance,
  service: JobService,
  bus: JobEventBus,
): void {
  app.get<{ Params: { jobId: string }; Querystring: { after?: string } }>(
    "/jobs/:jobId/events",
    (req, reply) => {
      const { jobId } = req.params;
      const snapshot = service.snapshot(jobId);
      if (!snapshot) {
        void reply.status(404).send({ error: "job_not_found" });
        return;
      }

      openStream(reply);

      // The stream opens with current state, so a client that connects late
      // — or after a reconnect — never has to call another endpoint to know
      // where the job stands.
      writeEvent(reply, { type: "state", jobId, job: snapshot, seq: 0 } as SequencedJobEvent);

      const cursor = resumeCursor(req.headers["last-event-id"], req.query.after);
      for (const missed of bus.replay(jobId, cursor)) writeEvent(reply, missed);

      const unsubscribe = bus.subscribe(jobId, (event) => {
        writeEvent(reply, event);
        // Terminal: let the client see it, then close rather than holding a
        // stream open on a job that will never emit again.
        if (event.type === "terminated") {
          setTimeout(() => reply.raw.end(), 50).unref?.();
        }
      });

      const keepalive = setInterval(() => reply.raw.write(": keepalive\n\n"), KEEPALIVE_MS);
      keepalive.unref?.();

      const cleanup = () => {
        clearInterval(keepalive);
        unsubscribe();
      };
      req.raw.on("close", cleanup);
      reply.raw.on("close", cleanup);
    },
  );
}

function openStream(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // The console is served from a different origin than the daemon.
    "access-control-allow-origin": "*",
    "x-accel-buffering": "no",
  });
}

function writeEvent(reply: FastifyReply, event: SequencedJobEvent): void {
  if (reply.raw.writableEnded) return;
  if (event.seq > 0) reply.raw.write(`id: ${event.seq}\n`);
  reply.raw.write(`event: ${event.type}\n`);
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * `Last-Event-ID` is what the browser's EventSource resends automatically;
 * `?after=` is the explicit form for clients that manage their own cursor.
 */
function resumeCursor(header: string | string[] | undefined, after: string | undefined): number {
  const raw = Array.isArray(header) ? header[0] : (header ?? after);
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}
