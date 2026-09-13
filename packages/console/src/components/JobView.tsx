import { useEffect, useReducer, useState } from "react";
import { emptyMeterState, reduceMeter } from "../lib/meter-state.js";
import { fetchArtifacts, subscribeToJob, type JobArtifacts } from "../lib/api.js";
import { stopRenewing } from "../lib/renter.js";
import { assetLabel } from "../lib/format.js";
import { Meter } from "./Meter.js";
import { Ticker } from "./Ticker.js";
import { Ledger } from "./Ledger.js";
import { Banner } from "./Banner.js";
import { useToast } from "./Toast.js";

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  const d = direction === "right" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6";
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  const [asideOpen, setAsideOpen] = useState(true);
  const { notify } = useToast();

  useEffect(() => {
    setError(undefined);
    setArtifacts(undefined);
    return subscribeToJob(jobId, dispatch, setError);
  }, [jobId]);

  const ended = state.terminated !== undefined;

  // The job's outcome is exactly the kind of thing worth surfacing even if
  // this tab isn't the one being watched right now — a rented site going
  // down is a result, not ambient state.
  useEffect(() => {
    if (!state.terminated) return;
    const { reason, finalBlockIndex } = state.terminated;
    const spent = state.receipts.reduce((total, r) => total + BigInt(r.amount), 0n).toString();
    const asset = assetLabel(state.snapshot?.asset);
    if (reason === "unpaid_boundary" || reason === "expired") {
      notify(
        "warning",
        "Job ended — wallet ran out",
        `${finalBlockIndex} blocks paid, ${spent} ${asset} spent.`,
      );
    } else {
      notify("info", `Job ended — ${reason}`, `${finalBlockIndex} blocks paid, ${spent} ${asset} spent.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.terminated]);

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
    <div className="job-layout">
      <div className="job-main">
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
        {error && (
          <Banner kind="warning" title="Lost the job stream">
            {error}
          </Banner>
        )}

        <Ledger jobId={jobId} />
      </div>

      {asideOpen ? (
        <aside className="job-aside rise" aria-label="Receipts and container output">
          <div className="job-aside__head">
            <h3>Details</h3>
            <button
              className="job-aside__toggle"
              onClick={() => setAsideOpen(false)}
              aria-label="Hide details"
              title="Hide details"
            >
              <ChevronIcon direction="right" />
            </button>
          </div>

          <Ticker lines={state.ticker} asset={state.snapshot?.asset} />

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
        </aside>
      ) : (
        <button
          className="job-aside__reopen"
          onClick={() => setAsideOpen(true)}
          aria-label="Show receipts and container output"
          title="Show details"
        >
          <ChevronIcon direction="right" />
        </button>
      )}
    </div>
  );
}
