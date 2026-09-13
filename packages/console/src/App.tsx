import { useCallback, useEffect, useState } from "react";
import { fetchJobs, fetchMachines, type Placement } from "./lib/api.js";
import type { MachineListing } from "./lib/types.js";
import { HCS_TOPIC_ID, topicUrl } from "./lib/explorer.js";
import { useRoute } from "./lib/route.js";
import { MachineList } from "./components/MachineList.js";
import { JobList } from "./components/JobList.js";
import { JobView } from "./components/JobView.js";
import { DemoMeter } from "./components/DemoMeter.js";

export function App() {
  const [machines, setMachines] = useState<MachineListing[]>([]);
  const [jobs, setJobs] = useState<Placement[]>([]);
  const [view, setView] = useRoute();
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, j] = await Promise.all([fetchMachines(), fetchJobs()]);
      setMachines(m);
      setJobs(j);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Tessera</h1>
        <p>Prepaid block settlement for continuous compute</p>
        <nav>
          <button
            className="tab"
            aria-current={view.name === "home" ? "page" : undefined}
            onClick={() => setView({ name: "home" })}
          >
            Machines
          </button>
          {view.name === "job" && (
            <button className="tab" aria-current="page">
              {view.jobId.slice(0, 12)}…
            </button>
          )}
        </nav>
      </header>

      {view.name === "job" ? (
        <JobView jobId={view.jobId} />
      ) : (
        <>
          {/* The most characteristic thing here is a payment stream you can
              watch, so the page leads with one rather than with copy. */}
          <DemoMeter />

          <div className="columns">
            <section className="panel card">
              <h2>Machines for rent</h2>
              {offline ? (
                <p className="error">
                  Can&apos;t reach the registry. Start it with{" "}
                  <code>node packages/control-plane/dist/index.js</code>.
                </p>
              ) : (
                <MachineList machines={machines} />
              )}
            </section>

            <section className="panel card">
              <h2>Live jobs</h2>
              {offline ? (
                <p className="empty">Waiting for the registry.</p>
              ) : (
                <JobList jobs={jobs} />
              )}
            </section>
          </div>

          <section className="prose">
            <h2>Pay for a block before it runs</h2>
            <p>
              A container runs continuously, but payment arrives in lumps. Serving on credit
              exposes the provider; escrow exposes the renter. Tessera divides time into fixed
              blocks, requires each block to be paid before it begins, and opens the window to
              buy the next block while the current one is still running.
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

            <h2 style={{ marginTop: "1.75rem" }}>Rent one</h2>
            <p>
              This page watches jobs; it never starts or pays for one. Renting means signing a
              payment with your own key, and a browser tab is the wrong place to keep one —
              which is the same reason the marketplace does not keep one either.
            </p>
            <pre className="snippet">{`const job = await marketplace.rent({
  machine: "node-a",
  image: "ghcr.io/you/ffmpeg:latest",
  budget: hbar(2),
  maxBlocks: 20,
});

job.on("block", (b) => console.log(b.index, b.txId));
await job.result();`}</pre>
            {HCS_TOPIC_ID && (
              <p>
                Every block settled here is published to the public consensus log,{" "}
                <a href={topicUrl(HCS_TOPIC_ID)} target="_blank" rel="noreferrer">
                  topic {HCS_TOPIC_ID}
                </a>
                . Nobody has to take the provider&apos;s word for what was billed.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
