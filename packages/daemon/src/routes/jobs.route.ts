import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { JobService } from "../jobs/job-service.js";

const CreateJobBody = z.object({
  renterUaid: z.string(),
  image: z.string(),
  cmd: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  blockSeconds: z.number().int().positive(),
  leadSeconds: z.number().int().positive(),
  pricePerBlock: z.string(),
  asset: z.string(),
});

export function registerJobsRoutes(app: FastifyInstance, service: JobService): void {
  app.post("/jobs", async (req, reply) => {
    const parsed = CreateJobBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const result = service.createJob(parsed.data);
    return reply.status(result.status).send(result.body);
  });

  app.get<{ Params: { jobId: string } }>("/jobs/:jobId", async (req, reply) => {
    const job = service.getJob(req.params.jobId);
    if (!job) return reply.status(404).send({ error: "job_not_found" });
    return reply.send(job);
  });
}
