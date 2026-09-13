import { useCallback, useEffect, useState } from "react";
import { fetchJobs, type Placement } from "../lib/api.js";
import { hrefFor } from "../lib/route.js";
import { LatestJob } from "./LatestJob.js";
import { JobList } from "./JobList.js";
import { Ledger } from "./Ledger.js";
import { SectionIcon, ICON } from "./SectionIcon.js";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/**
 * One renter's own view.
 *
 * Kept apart from the marketplace on purpose: the marketplace is public and
 * shows what is for rent, while this shows what *you* are paying for. Putting
 * a live meter on the shared page made one renter's spend look like the
 * state of the market.
 */
export function RenterDashboard({ renterId }: { renterId: string }) {
  const [jobs, setJobs] = useState<Placement[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setJobs(await fetchJobs(renterId));
    } catch {
      // The marketplace panel reports registry trouble; don't say it twice.
    } finally {
      setLoaded(true);
    }
  }, [renterId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(id);
  }, [load]);

  const newest = jobs[0];
  const machinesUsed = new Set(jobs.map((j) => j.machineId)).size;

  return (
    <>
      <section className="section">
        <header className="dash">
          <div className="section__title">
            <SectionIcon path={ICON.user} />
            <div>
              <h2>Your rentals</h2>
              <p className="empty">
                Paying as <b className="mono">{renterId}</b>
              </p>
            </div>
          </div>
          <a className="btn btn--quiet" href={hrefFor({ name: "marketplace" })}>
            Browse machines
          </a>
        </header>

        {loaded && jobs.length > 0 && (
          <div className="stat-strip">
            <div className="stat-strip__cell">
              <span className="stat-strip__label">Total rentals</span>
              <span className="stat-strip__value">{jobs.length}</span>
            </div>
            <div className="stat-strip__cell">
              <span className="stat-strip__label">Machines used</span>
              <span className="stat-strip__value">{machinesUsed}</span>
            </div>
            {newest && (
              <div className="stat-strip__cell">
                <span className="stat-strip__label">Most recent</span>
                <span className="stat-strip__value">{timeAgo(newest.placedAt)}</span>
              </div>
            )}
          </div>
        )}

        {newest ? (
          <LatestJob jobId={newest.jobId} />
        ) : (
          loaded && (
            <section className="panel card idle">
              <h2>You haven&apos;t rented anything yet</h2>
              <p>
                Rent a machine from the marketplace, or from the terminal with{" "}
                <code>tessera rent --machine node-a --blocks 10</code>.
              </p>
            </section>
          )
        )}
      </section>

      {jobs.length > 1 && (
        <section className="section">
          <div className="section__head">
            <div className="section__title">
              <SectionIcon path={ICON.history} />
              <h2>Earlier rentals</h2>
            </div>
          </div>
          <p className="section__sub">Every other job this account has placed, newest first.</p>
          <div className="card panel">
            <JobList jobs={jobs.slice(1)} />
          </div>
        </section>
      )}

      <section className="section">
        <Ledger />
      </section>
    </>
  );
}
