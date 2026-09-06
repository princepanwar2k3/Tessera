import Fastify, { type FastifyInstance } from "fastify";
import type { JobService } from "./jobs/job-service.js";
import { registerHealthRoute, type HealthInfo } from "./routes/health.route.js";
import { registerJobsRoutes } from "./routes/jobs.route.js";
import { registerBlocksRoutes } from "./routes/blocks.route.js";
import type { Logger } from "./logging.js";

export function buildServer(service: JobService, logger: Logger, healthInfo: HealthInfo): FastifyInstance {
  // Fastify's own request logger is disabled; all app logging goes through
  // the shared pino `logger` passed to JobService and friends instead.
  void logger;
  const app = Fastify({ logger: false });

  registerHealthRoute(app, healthInfo);
  registerJobsRoutes(app, service);
  registerBlocksRoutes(app, service);

  return app;
}
