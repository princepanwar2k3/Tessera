import type { ReactNode } from "react";
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
  renderForm?: (machine: MachineListing) => ReactNode;
}

interface Org {
  providerId: string;
  machines: MachineListing[];
}

/** Machines, grouped by who is offering them, in first-seen order. */
function groupByProvider(machines: MachineListing[]): Org[] {
  const order: string[] = [];
  const byId = new Map<string, MachineListing[]>();
  for (const m of machines) {
    let bucket = byId.get(m.providerId);
    if (!bucket) {
      bucket = [];
      byId.set(m.providerId, bucket);
      order.push(m.providerId);
    }
    bucket.push(m);
  }
  return order.map((providerId) => ({ providerId, machines: byId.get(providerId) ?? [] }));
}

/** A two-letter mark for the org avatar, the way an initial stands in for a logo. */
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
 * What is for rent, organized the way a vendor directory is: one card per
 * provider (the org), its machines listed underneath like seats in that
 * org's own chart and connected to it by a branch line, rather than
 * repeated as identical anonymous cards. Price and block size sit together
 * on each row as the two headline numbers, because together they are the
 * cost: a cheaper node with coarse blocks can cost more for a short job than
 * a dearer one with fine blocks — granularity is what this marketplace lets
 * people shop on, so it is not buried in a spec list.
 */
export function MachineList({
  machines,
  loaded = true,
  canRent,
  rentingId,
  onRent,
  renderForm,
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

  const orgs = groupByProvider(machines);

  return (
    <div className="orgs">
      {orgs.map((org) => {
        const live = org.machines.filter((m) => m.live);
        const cpu = org.machines.reduce((n, m) => n + m.specs.cpuCores, 0);
        const memGb = Math.round(org.machines.reduce((n, m) => n + m.specs.memoryMB, 0) / 1024);
        const prices = org.machines.map((m) => Number(m.params.pricePerBlock));
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const asset = assetLabel(org.machines[0]?.params.asset);
        const offline = live.length === 0;

        return (
          <article className="org" key={org.providerId}>
            <header className="org__head">
              <span
                className={`org__avatar${offline ? " org__avatar--offline" : ""}`}
                style={offline ? undefined : { background: colorFor(org.providerId) }}
                aria-hidden="true"
              >
                {initials(org.providerId)}
              </span>
              <div className="org__id">
                <div className="org__name">
                  {org.providerId}
                  <span className="org__tag">
                    {org.machines.length === 1 ? "1 machine" : `${org.machines.length} machines`}
                  </span>
                </div>
                <p className="org__meta">
                  <span>
                    <b>{live.length}</b>/{org.machines.length} online
                  </span>
                  <span>
                    <b>{cpu}</b> vCPU total
                  </span>
                  <span>
                    <b>{memGb}</b> GB total
                  </span>
                  <span>
                    {min === max ? (
                      <>
                        <b>{min}</b> {asset} per block
                      </>
                    ) : (
                      <>
                        <b>
                          {min}–{max}
                        </b>{" "}
                        {asset} per block
                      </>
                    )}
                  </span>
                </p>
              </div>
            </header>

            <div className="org__machines">
              {org.machines.map((m) => {
                const renting = rentingId === m.machineId;
                const busy = (m.activeJobs ?? 0) > 0;

                return (
                  <div className={`org-row${renting ? " org-row--renting" : ""}`} key={m.machineId}>
                    <div className="org-row__id">
                      {m.machineId}
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

                    <div className="org-row__col">
                      <span className="org-row__label">Price</span>
                      <span className="org-row__value">
                        {m.params.pricePerBlock} {assetLabel(m.params.asset)} / {m.params.blockSeconds}
                        s
                      </span>
                    </div>

                    <div className="org-row__col">
                      <span className="org-row__label">Window</span>
                      <span className="org-row__value">{m.params.leadSeconds}s</span>
                    </div>

                    <div className="org-row__col">
                      <span className="org-row__label">Hardware</span>
                      <span className="org-row__value">
                        {m.specs.cpuCores} vCPU · {Math.round(m.specs.memoryMB / 1024)} GB
                      </span>
                    </div>

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

                    {renting && <div className="org-row__form">{renderForm?.(m)}</div>}
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}
