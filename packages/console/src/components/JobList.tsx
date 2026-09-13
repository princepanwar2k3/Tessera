import type { Placement } from "../lib/api.js";
import { hrefFor } from "../lib/route.js";

interface Props {
  jobs: Placement[];
}

/** Jobs the registry has placed, newest first. Click one to watch it settle. */
export function JobList({ jobs }: Props) {
  if (jobs.length === 0) {
    return (
      <p className="empty">
        No jobs yet. Rent a machine from the SDK or run{" "}
        <code>pnpm -F @bsp/agent demo</code>, then watch it here.
      </p>
    );
  }

  return (
    <ul className="jobs">
      {jobs.map((job) => (
        <li key={job.jobId}>
          {/* A real link, so a job can be opened in a new tab or shared. */}
          <a className="job" href={hrefFor({ name: "job", jobId: job.jobId })}>
            <span className="job__id">{job.jobId}</span>
            <span className="job__meta">
              {job.machineId} · {new Date(job.placedAt).toLocaleTimeString()}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
