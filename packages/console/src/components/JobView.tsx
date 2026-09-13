import { useEffect, useReducer, useState } from "react";
import { emptyMeterState, reduceMeter } from "../lib/meter-state.js";
import { fetchArtifacts, subscribeToJob, type JobArtifacts } from "../lib/api.js";
import { HCS_TOPIC_ID, topicUrl } from "../lib/explorer.js";
import { Meter } from "./Meter.js";
import { Ticker } from "./Ticker.js";

/**
 * Screen 2: one job, watched live.
 *
 * The meter, the receipts, and — once the job stops — what the container
 * actually produced. Artifacts from paid blocks are delivered even when the
 * job ended `expired` (SPEC §5.5), and showing them is how that stops being
 * a claim in a document.
 */
export function JobView({ jobId }: { jobId: string }) {
  const [state, dispatch] = useReducer(reduceMeter, emptyMeterState);
  const [error, setError] = useState<string | undefined>();
  const [artifacts, setArtifacts] = useState<JobArtifacts | undefined>();

  useEffect(() => {
    setError(undefined);
    setArtifacts(undefined);
    return subscribeToJob(jobId, dispatch, setError);
  }, [jobId]);

  const ended = state.terminated !== undefined;
  useEffect(() => {
    if (!ended) return;
    let cancelled = false;
    // The daemon flushes artifacts during its shutdown sequence, so the first
    // read right after termination can land before they exist.
    const attempt = (tries: number) => {
      void fetchArtifacts(jobId).then((a) => {
        if (cancelled) return;
        if (a?.artifacts) setArtifacts(a);
        else if (tries > 0) window.setTimeout(() => attempt(tries - 1), 1000);
      });
    };
    attempt(6);
    return () => {
      cancelled = true;
    };
  }, [ended, jobId]);

  const logs = artifacts?.artifacts?.stdout?.trimEnd();

  return (
    <>
      <Meter state={state} />
      {error && <p className="error">{error}</p>}
      <Ticker lines={state.ticker} asset={state.snapshot?.asset} />

      {HCS_TOPIC_ID && (
        <p className="empty" style={{ marginTop: "0.6rem" }}>
          Every receipt above is also on the public consensus log —{" "}
          <a href={topicUrl(HCS_TOPIC_ID)} target="_blank" rel="noreferrer">
            topic {HCS_TOPIC_ID}
          </a>
          .
        </p>
      )}

      {ended && (
        <section className="card panel" aria-label="Container output">
          <h2>Container output</h2>
          {logs ? (
            <pre className="logs">{logs}</pre>
          ) : (
            <p className="empty">Collecting output from the provider…</p>
          )}
          <p className="empty" style={{ marginTop: "0.6rem" }}>
            Delivered even though the job ended for non-payment. The renter paid for
            that work.
          </p>
        </section>
      )}
    </>
  );
}
