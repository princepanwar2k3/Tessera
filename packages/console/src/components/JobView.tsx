import { useEffect, useReducer, useState } from "react";
import { emptyMeterState, reduceMeter } from "../lib/meter-state.js";
import { fetchArtifacts, subscribeToJob, type JobArtifacts } from "../lib/api.js";
import { stopRenewing } from "../lib/renter.js";
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
export function JobView({
  jobId,
  renterUrl,
}: {
  jobId: string;
  /** Present only when this job's renter agent is connected here. */
  renterUrl?: string | undefined;
}) {
  const [state, dispatch] = useReducer(reduceMeter, emptyMeterState);
  const [error, setError] = useState<string | undefined>();
  const [artifacts, setArtifacts] = useState<JobArtifacts | undefined>();
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);

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
  const serviceUrl = state.snapshot?.serviceUrl;

  return (
    <>
      {serviceUrl && (
        <section className={`card served${ended ? " served--gone" : ""}`}>
          <div>
            <h2>{ended ? "This site is gone" : "This site is live"}</h2>
            <p>
              {ended
                ? "The renter stopped paying, so the provider stopped serving it at the block boundary."
                : "Served by the rented container, for as long as the next block is paid for."}
            </p>
          </div>
          {ended ? (
            <span className="served__url served__url--dead">{serviceUrl}</span>
          ) : (
            <a className="served__url" href={serviceUrl} target="_blank" rel="noreferrer">
              {serviceUrl}
            </a>
          )}
        </section>
      )}

      {renterUrl && !ended && (
        <div className="killswitch">
          <button
            className="btn btn--stop"
            disabled={stopping || stopped}
            onClick={() => {
              setStopping(true);
              void stopRenewing(renterUrl, jobId)
                .then(() => setStopped(true))
                .catch((err: Error) => setError(err.message))
                .finally(() => setStopping(false));
            }}
          >
            {stopped ? "Not renewing" : stopping ? "Stopping…" : "Stop renewing"}
          </button>
          <span className="empty">
            {stopped
              ? "Nothing was sent to the provider. The job ends at the next boundary."
              : "Stops buying blocks. The current block still runs to its end."}
          </span>
        </div>
      )}

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
