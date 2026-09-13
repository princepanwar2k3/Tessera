import { useCallback, useEffect, useState } from "react";
import { fetchJobs, type Placement } from "../lib/api.js";
import { hrefFor } from "../lib/route.js";
import { LatestJob } from "./LatestJob.js";
import { JobList } from "./JobList.js";
import { Ledger } from "./Ledger.js";

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

  return (
    <>
      <header className="dash">
        <div>
          <h2>Your rentals</h2>
          <p className="empty">
            Paying as <b className="mono">{renterId}</b>
          </p>
        </div>
        <a className="btn btn--quiet" href={hrefFor({ name: "home" })}>
          Browse machines
        </a>
      </header>

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

      {jobs.length > 1 && (
        <section className="panel card">
          <h2>Earlier rentals</h2>
          <JobList jobs={jobs.slice(1)} />
        </section>
      )}

      <Ledger />
    </>
  );
}
