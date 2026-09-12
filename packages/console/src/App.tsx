import { useCallback, useEffect, useState } from "react";
import { fetchMachines, placeJob } from "./lib/api.js";
import type { MachineListing } from "./lib/types.js";
import { MachineList } from "./components/MachineList.js";
import { JobView } from "./components/JobView.js";
import { DemoMeter } from "./components/DemoMeter.js";

type View = { name: "machines" } | { name: "job"; jobId: string };

export function App() {
  const [machines, setMachines] = useState<MachineListing[]>([]);
  const [view, setView] = useState<View>({ name: "machines" });
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      setMachines(await fetchMachines());
      setError(undefined);
    } catch {
      setError("Can't reach the registry. Check it is running, then reload.");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(id);
  }, [load]);

  const rent = async (machine: MachineListing) => {
    setBusy(machine.machineId);
    try {
      const { jobId } = await placeJob({
        machineId: machine.machineId,
        image: "busybox:latest",
        renterUaid: "uaid:console:viewer",
      });
      setView({ name: "job", jobId });
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the job.");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Tessera</h1>
        <p>Prepaid block settlement for continuous compute</p>
        <nav>
          <button
            className="tab"
            aria-current={view.name === "machines" ? "page" : undefined}
            onClick={() => setView({ name: "machines" })}
          >
            Machines
          </button>
          {view.name === "job" && (
            <button className="tab" aria-current="page">
              Job {view.jobId.slice(0, 10)}
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

          <section className="panel card">
            <h2>Machines for rent</h2>
            {error ? (
              <p className="error">{error}</p>
            ) : (
              <MachineList machines={machines} onRent={rent} busyMachineId={busy} />
            )}
          </section>

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
          </section>
        </>
      )}
    </main>
  );
}
