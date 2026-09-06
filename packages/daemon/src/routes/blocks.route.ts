import type { FastifyInstance } from "fastify";
import type { JobService } from "../jobs/job-service.js";

export function registerBlocksRoutes(app: FastifyInstance, service: JobService): void {
  app.get<{ Params: { jobId: string; n: string } }>(
    "/jobs/:jobId/blocks/:n",
    async (req, reply) => {
      const blockIndex = Number(req.params.n);
      const result = service.getBlockResource(req.params.jobId, blockIndex);
      return reply.status(result.status).send(result.body);
    },
  );

  app.post<{ Params: { jobId: string; n: string }; Body: unknown }>(
    "/jobs/:jobId/blocks/:n/payment",
    async (req, reply) => {
      const blockIndex = Number(req.params.n);
      const result = await service.submitPayment(req.params.jobId, blockIndex, req.body);
      return reply.status(result.status).send(result.body);
    },
  );
}
