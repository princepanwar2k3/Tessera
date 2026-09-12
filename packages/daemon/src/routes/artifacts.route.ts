import type { FastifyInstance } from "fastify";
import type { JobService } from "../jobs/job-service.js";

/**
 * SPEC §5.5 — artifacts produced during paid blocks MUST be delivered even on
 * `expired` termination. The renter paid for that work, so this endpoint does
 * not care *why* the job ended.
 */
export function registerArtifactsRoute(app: FastifyInstance, service: JobService): void {
  app.get<{ Params: { jobId: string } }>("/jobs/:jobId/artifacts", async (req, reply) => {
    const result = service.getArtifacts(req.params.jobId);
    return reply.status(result.status).send(result.body);
  });
}
