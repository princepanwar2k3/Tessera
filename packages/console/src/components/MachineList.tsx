import type { ReactNode } from "react";
import type { MachineListing } from "../lib/types.js";
import { assetLabel } from "../lib/format.js";

interface Props {
  machines: MachineListing[];
  /** False until the first fetch lands, so "none listed" isn't shown too early. */
  loaded?: boolean;
  canRent?: boolean;
  rentingId?: string | undefined;
  onRent?: (machine: MachineListing) => void;
  renderForm?: (machine: MachineListing) => ReactNode;
}

/**
 * What is for rent.
 *
 * Price and block size sit together as the two headline numbers, because
 * together they are the cost: a cheaper node with coarse blocks can cost more
 * for a short job than a dearer one with fine blocks. Granularity is what this
 * marketplace lets people shop on, so it is not buried in a spec list.
 */
export function MachineList({
  machines,
  loaded = true,
  canRent,
  rentingId,
  onRent,
  renderForm,
}: Props) {
  if (!loaded) return <p className="empty">Checking the registry…</p>;

  if (machines.length === 0) {
    return (
      <p className="empty">
        No machines listed. A provider adds one with{" "}
        <code>tessera-node list --block-seconds 15 --price 25</code>.
      </p>
    );
  }

  return (
    <div className="machines">
      {machines.map((m) => {
        const renting = rentingId === m.machineId;
        return (
          <article className={`machine${renting ? " machine--renting" : ""}`} key={m.machineId}>
            <header className="machine__top">
              <h3>{m.machineId}</h3>
              <span className={m.live ? "live" : "live live--off"}>
                {m.live ? "online" : "offline"}
              </span>
            </header>

            <div className="machine__price">
              <span className="machine__amount">{m.params.pricePerBlock}</span>
              <span className="machine__unit">
                {assetLabel(m.params.asset)} per {m.params.blockSeconds}s block
              </span>
            </div>

            <dl className="machine__spec">
              <dt>Renewal window</dt>
              <dd>{m.params.leadSeconds}s</dd>
              <dt>Hardware</dt>
              <dd>
                {m.specs.cpuCores} vCPU · {Math.round(m.specs.memoryMB / 1024)} GB
              </dd>
              <dt>Benchmark</dt>
              <dd>{Math.round(m.benchmark.score).toLocaleString()}</dd>
            </dl>

            {renting
              ? renderForm?.(m)
              : canRent && (
                  <button className="btn" onClick={() => onRent?.(m)} disabled={!m.live}>
                    Rent this machine
                  </button>
                )}
          </article>
        );
      })}
    </div>
  );
}
