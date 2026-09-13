import type { MachineListing } from "../lib/types.js";

interface Props {
  machines: MachineListing[];
  /** Only offered once a renter agent is connected — nothing else can pay. */
  canRent?: boolean;
  rentingId?: string | undefined;
  onRent?: (machine: MachineListing) => void;
  renderForm?: (machine: MachineListing) => React.ReactNode;
}

/**
 * Screen 1: what is for rent.
 *
 * Block size sits beside price deliberately — it is half the cost of a job
 * (SPEC §4.2) and the thing this marketplace lets renters shop on.
 */
export function MachineList({ machines, canRent, rentingId, onRent, renderForm }: Props) {
  if (machines.length === 0) {
    return <p className="empty">No machines online. Start a provider node to list one.</p>;
  }

  return (
    <div className="machines">
      {machines.map((m) => (
        <article className="card machine" key={m.machineId}>
          <div className="machine__top">
            <h3>{m.machineId}</h3>
            <span className={m.live ? "live" : "live live--off"}>
              {m.live ? "Online" : "Offline"}
            </span>
          </div>

          <dl>
            <dt>Price per block</dt>
            <dd>
              {m.params.pricePerBlock} {m.params.asset}
            </dd>
            <dt>Block size</dt>
            <dd>{m.params.blockSeconds}s</dd>
            <dt>Renewal window</dt>
            <dd>{m.params.leadSeconds}s</dd>
            <dt>Hardware</dt>
            <dd>
              {m.specs.cpuCores} vCPU · {Math.round(m.specs.memoryMB / 1024)} GB
            </dd>
            <dt>Benchmark</dt>
            <dd>{Math.round(m.benchmark.score).toLocaleString()}</dd>
          </dl>

          {rentingId === m.machineId
            ? renderForm?.(m)
            : canRent && (
                <button className="btn" onClick={() => onRent?.(m)} disabled={!m.live}>
                  Rent this machine
                </button>
              )}

        </article>
      ))}
    </div>
  );
}
