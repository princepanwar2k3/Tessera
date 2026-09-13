import type { MachineListing } from "../lib/types.js";
import { assetLabel } from "../lib/format.js";
import { Chip } from "./Chip.js";

interface Props {
  machines: MachineListing[];
  /** False until the first fetch lands, so "none listed" isn't shown too early. */
  loaded?: boolean;
  canRent?: boolean;
  rentingId?: string | undefined;
  onRent?: (machine: MachineListing) => void;
}

/** A two-letter mark for a provider's badge, the way an initial stands in for a logo. */
function initials(id: string): string {
  const parts = id.split(/[-_\s]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  return id.slice(0, 2).toUpperCase();
}

/** A stable color per provider id, the way a project avatar gets a color that
 *  doesn't change between visits — a small palette, not a random one. */
const PALETTE = ["#1a73e8", "#188038", "#8430ce", "#c5221f", "#e37400", "#12857b"];
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

function skeleton() {
  return (
    <div className="skeleton-rows" aria-hidden="true">
      <div className="skeleton skeleton-org" />
      <div className="skeleton skeleton-org" />
    </div>
  );
}

/**
 * What is for rent: every machine as its own card in one grid, the way a
 * resource list shows individual instances — each one a thing you can act
 * on, not a row in a table. Price and block size sit together on each card
 * as the two headline numbers, because together they are the cost: a
 * cheaper node with coarse blocks can cost more for a short job than a
 * dearer one with fine blocks — granularity is what this marketplace lets
 * people shop on, so it is not buried in a spec list.
 */
export function MachineList({
  machines,
  loaded = true,
  canRent,
  rentingId,
  onRent,
}: Props) {
  if (!loaded) return skeleton();

  if (machines.length === 0) {
    return (
      <p className="empty">
        No machines listed. A provider adds one with{" "}
        <code>tessera-node list --block-seconds 15 --price 25</code>.
      </p>
    );
  }

  return (
    <div className="machines-grid">
      {machines.map((m) => {
        const renting = rentingId === m.machineId;
        const busy = (m.activeJobs ?? 0) > 0;

        const accent = colorFor(m.providerId);

        return (
          <article
            className={`machine-card${renting ? " machine-card--renting" : ""}`}
            key={m.machineId}
          >
            <div className="machine-card__top">
              <div className="machine-card__who">
                <span className="machine-card__avatar" style={{ background: accent }} aria-hidden="true">
                  {initials(m.providerId)}
                </span>
                <div className="machine-card__names">
                  <span className="machine-card__id">{m.machineId}</span>
                  <span className="machine-card__provider">{m.providerId}</span>
                </div>
              </div>
              {!m.live ? (
                <Chip tone="danger">offline</Chip>
              ) : busy ? (
                <Chip tone="warning">
                  in use · {m.activeJobs} {m.activeJobs === 1 ? "job" : "jobs"}
                </Chip>
              ) : (
                <Chip tone="success">idle</Chip>
              )}
            </div>

            <div className="machine-card__price">
              <span className="machine-card__price-amount">
                {m.params.pricePerBlock} <span>{assetLabel(m.params.asset)}</span>
              </span>
              <span className="machine-card__price-unit">per {m.params.blockSeconds}s block</span>
            </div>

            <dl className="machine-card__specs">
              <div className="machine-card__stat">
                <dt>Window</dt>
                <dd>{m.params.leadSeconds}s</dd>
              </div>
              <div className="machine-card__stat">
                <dt>vCPU</dt>
                <dd>{m.specs.cpuCores}</dd>
              </div>
              <div className="machine-card__stat">
                <dt>Memory</dt>
                <dd>{Math.round(m.specs.memoryMB / 1024)} GB</dd>
              </div>
            </dl>

            {renting ? (
              <Chip tone="info" dot={false}>
                configuring…
              </Chip>
            ) : (
              canRent && (
                <button className="btn" onClick={() => onRent?.(m)} disabled={!m.live}>
                  Rent
                </button>
              )
            )}
          </article>
        );
      })}
    </div>
  );
}
