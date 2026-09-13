import { useEffect, useReducer } from "react";
import { emptyMeterState, reduceMeter } from "../lib/meter-state.js";
import { subscribeToJob } from "../lib/api.js";
import { hrefFor } from "../lib/route.js";
import { Meter } from "./Meter.js";
import { Ticker } from "./Ticker.js";
import { Chip } from "./Chip.js";

/**
 * The newest real job, on the landing page.
 *
 * When anything is actually running, the page leads with that rather than
 * with the scripted sample — a looping demo beside a live marketplace reads
 * as decoration, and the real thing is more convincing anyway.
 */
export function LatestJob({ jobId }: { jobId: string }) {
  const [state, dispatch] = useReducer(reduceMeter, emptyMeterState);

  useEffect(() => subscribeToJob(jobId, dispatch), [jobId]);

  const serviceUrl = state.snapshot?.serviceUrl;
  const ended = state.terminated !== undefined;

  return (
    <>
      <Meter state={state} />
      <p className="empty" style={{ margin: "0.6rem 0 0", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        {ended ? <Chip tone="danger">ended</Chip> : <Chip tone="success">live</Chip>}
        <a href={hrefFor({ name: "job", jobId })} className="mono-link">
          {jobId.slice(0, 16)}…
        </a>
        {serviceUrl && !ended && (
          <>
            {"· serving "}
            <a href={serviceUrl} target="_blank" rel="noreferrer">
              {serviceUrl}
            </a>
          </>
        )}
      </p>
      <Ticker lines={state.ticker} asset={state.snapshot?.asset} fixedHeight />
    </>
  );
}
