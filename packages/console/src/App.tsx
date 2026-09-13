import { useCallback, useEffect, useState } from "react";
import { fetchJobs, fetchMachines, type Placement } from "./lib/api.js";
import type { MachineListing } from "./lib/types.js";
import { savedRenterUrl, type RenterIdentity } from "./lib/renter.js";
import { MachineList } from "./components/MachineList.js";
import { JobList } from "./components/JobList.js";
import { JobView } from "./components/JobView.js";
import { LatestJob } from "./components/LatestJob.js";
import { Ledger } from "./components/Ledger.js";
import { RenterPanel } from "./components/RenterPanel.js";
import { RentForm } from "./components/RentForm.js";
import { useRoute } from "./lib/route.js";

export function App() {
  const [machines, setMachines] = useState<MachineListing[]>([]);
  const [jobs, setJobs] = useState<Placement[]>([]);
  const [view, setView] = useRoute();
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [renterUrl, setRenterUrl] = useState(savedRenterUrl());
  const [identity, setIdentity] = useState<RenterIdentity | undefined>();
  const [rentingId, setRentingId] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      const [m, j] = await Promise.all([fetchMachines(), fetchJobs()]);
      setMachines(m);
      setJobs(j);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(id);
  }, [load]);

  const newest = jobs[0];

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead__name">
          <h1>Tessera</h1>
          <p>Rent a machine by the block. Pay before each one runs.</p>
        </div>
        <RenterPanel
          baseUrl={renterUrl}
          identity={identity}
          onConnected={(url, who) => {
            setRenterUrl(url);
            setIdentity(who);
          }}
        />
      </header>

      {view.name === "job" ? (
        <>
          <p className="backlink">
            <a href="#/">Back to machines</a>
          </p>
          <JobView jobId={view.jobId} renterUrl={identity ? renterUrl : undefined} />
        </>
      ) : (
        <>
          {/* The page leads with whatever is actually true: a running job if
              there is one, otherwise the marketplace. Never a simulation —
              an idle console that looks busy is worse than an empty one. */}
          {newest && (
            <section className="lead">
              <LatestJob jobId={newest.jobId} />
            </section>
          )}

          <section className="panel card">
            <div className="panel__head">
              <h2>Machines for rent</h2>
              {identity ? (
                <span className="empty">Pick one and choose how many blocks to buy.</span>
              ) : (
                <span className="empty">Connect a renter agent to rent one.</span>
              )}
            </div>

            {offline ? (
              <p className="error">
                Can&apos;t reach the registry. Start it with{" "}
                <code>node packages/control-plane/dist/index.js</code>.
              </p>
            ) : (
              <MachineList
                machines={machines}
                loaded={loaded}
                canRent={identity !== undefined}
                rentingId={rentingId}
                onRent={(m) => setRentingId(m.machineId)}
                renderForm={(m) => (
                  <RentForm
                    machine={m}
                    renterUrl={renterUrl}
                    onCancel={() => setRentingId(undefined)}
                    onRented={(job) => {
                      setRentingId(undefined);
                      void load();
                      setView({ name: "job", jobId: job.jobId });
                    }}
                  />
                )}
              />
            )}
          </section>

          {!newest && loaded && !offline && (
            <section className="panel card idle">
              <h2>Nothing is running</h2>
              <p>
                Rent a machine above and its meter appears here — one block at a time, each
                paid for before it runs.
              </p>
            </section>
          )}

          {jobs.length > 1 && (
            <section className="panel card">
              <h2>Earlier jobs</h2>
              <JobList jobs={jobs.slice(1)} />
            </section>
          )}

          <Ledger />

          <section className="prose">
            <h2>Pay for a block before it runs</h2>
            <p>
              A container runs continuously, but payment arrives in lumps. Serving on credit
              exposes the provider; a deposit exposes the renter. Tessera divides time into
              fixed blocks, requires each one to be paid before it begins, and opens the
              window to buy the next while the current one is still running.
            </p>
            <ul className="invariants">
              <li>
                <b>No credit.</b> The provider never computes on an unpaid block.
              </li>
              <li>
                <b>Bounded loss.</b> The renter can lose at most one block.
              </li>
              <li>
                <b>Deterministic end.</b> Service stops at a boundary, never between.
              </li>
              <li>
                <b>No custody.</b> Payment goes renter to provider. Nothing is escrowed.
              </li>
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
