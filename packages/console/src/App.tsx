import { useCallback, useEffect, useState } from "react";
import { fetchJobs, fetchMachines, type Placement } from "./lib/api.js";
import type { MachineListing } from "./lib/types.js";
import { savedRenterUrl, type RenterIdentity } from "./lib/renter.js";
import { MachineList } from "./components/MachineList.js";
import { JobList } from "./components/JobList.js";
import { JobView } from "./components/JobView.js";
import { RenterDashboard } from "./components/RenterDashboard.js";
import { Ledger } from "./components/Ledger.js";
import { RenterPanel } from "./components/RenterPanel.js";
import { RentForm } from "./components/RentForm.js";
import { Modal } from "./components/Modal.js";
import { Banner } from "./components/Banner.js";
import { SectionIcon, ICON } from "./components/SectionIcon.js";
import { hrefFor, useRoute, type Route } from "./lib/route.js";
import { assetLabel } from "./lib/format.js";

const TOPNAV: { route: Route; label: string }[] = [
  { route: { name: "marketplace" }, label: "Marketplace" },
  { route: { name: "ledger" }, label: "Consensus log" },
  { route: { name: "about" }, label: "About" },
];

function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      className="brandmark"
      width={size}
      height={size}
      viewBox="0 0 26 26"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="10.5" height="10.5" rx="2.5" fill="#1a73e8" />
      <rect x="14.5" y="1" width="10.5" height="10.5" rx="2.5" fill="#1a73e8" opacity="0.5" />
      <rect x="1" y="14.5" width="10.5" height="10.5" rx="2.5" fill="#1a73e8" opacity="0.5" />
      <rect x="14.5" y="14.5" width="10.5" height="10.5" rx="2.5" fill="#f0a22e" />
    </svg>
  );
}

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

  const stats = {
    providers: new Set(machines.map((m) => m.providerId)).size,
    online: machines.filter((m) => m.live).length,
    total: machines.length,
    cheapest: machines.length
      ? (() => {
          const cheapest = machines.reduce((a, b) =>
            Number(a.params.pricePerBlock) <= Number(b.params.pricePerBlock) ? a : b,
          );
          return `${cheapest.params.pricePerBlock} ${assetLabel(cheapest.params.asset)}`;
        })()
      : undefined,
  };

  return (
    <>
      <header className="topbar">
        <a className="topbar__brand" href={hrefFor({ name: "marketplace" })}>
          <BrandMark />
          <span className="topbar__name">Tessera</span>
        </a>

        <nav className="topnav" aria-label="Main">
          {TOPNAV.map(({ route, label }) => (
            <a
              key={label}
              href={hrefFor(route)}
              className={`topnav__link${view.name === route.name ? " topnav__link--active" : ""}`}
            >
              {label}
            </a>
          ))}
        </nav>

        <span className="topbar__spacer" />
        <div className="topbar__meta">
          <RenterPanel
            baseUrl={renterUrl}
            identity={identity}
            onConnected={(url, who) => {
              setRenterUrl(url);
              setIdentity(who);
            }}
          />
        </div>
      </header>

      <main className="content">
        <div
          className="view"
          key={
            view.name === "job"
              ? `job:${view.jobId}`
              : view.name === "renter"
                ? `renter:${view.renterId}`
                : view.name
          }
        >
          {view.name === "job" ? (
            <>
              <p className="breadcrumb">
                <a href={hrefFor({ name: "marketplace" })}>Marketplace</a>
                <span>/</span>
                <span className="mono">{view.jobId}</span>
              </p>
              <JobView jobId={view.jobId} renterUrl={identity ? renterUrl : undefined} />
            </>
          ) : view.name === "renter" ? (
            <>
              <p className="breadcrumb">
                <a href={hrefFor({ name: "marketplace" })}>Marketplace</a>
                <span>/</span>
                <span className="mono">{view.renterId}</span>
              </p>
              <RenterDashboard renterId={view.renterId} />
            </>
          ) : view.name === "ledger" ? (
            <Ledger />
          ) : view.name === "about" ? (
            <section className="section">
              <div className="section__head">
                <div className="section__title">
                  <SectionIcon path={ICON.info} />
                  <h2>About Tessera</h2>
                </div>
              </div>
              <div className="prose">
                <p>
                  Tessera is a marketplace for renting compute by the block — fixed-length slices
                  of time, each paid for before it runs. It exists to remove the trust problem in
                  renting from someone you've never met: normally either the provider serves on
                  credit and hopes to get paid, or the renter pays a deposit up front and hopes
                  the provider delivers. The <b>Block Settlement Protocol</b> (BSP) removes both —
                  service stops cleanly at the first unpaid boundary, and neither side ever
                  extends credit.
                </p>
                <p>
                  Every payment here settles on Hedera testnet through the Blocky402 x402
                  facilitator, in a custom HTS token, and every receipt is published to Hedera's
                  consensus service — so a provider's billing history is something anyone can
                  check, not just a number in this app's own database.
                </p>

                <h3>Pay for a block before it runs</h3>
                <p>
                  A container runs continuously, but payment arrives in lumps. Tessera divides
                  time into fixed blocks, requires each one to be paid before it begins, and opens
                  the window to buy the next while the current one is still running.
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
              </div>
            </section>
          ) : (
            <>
              <div className="hero">
                <div className="hero__copy">
                  <span className="hero__eyebrow">Marketplace</span>
                  <h1 className="hero__title">
                    Rent a computer <span className="hero__accent">by the block, not the month.</span>
                  </h1>
                  <p className="hero__text">
                    Every block is paid on <b>Hedera</b> before it runs — no credit extended,
                    no deposit held, and the provider gets paid directly. Every receipt lands
                    on a public consensus log anyone can audit.
                  </p>
                  <ul className="hero__points">
                    <li>No credit</li>
                    <li>No deposit</li>
                    <li>Instant settlement</li>
                  </ul>
                  <a className="hero__cta" href={hrefFor({ name: "ledger" })}>
                    See it settle on-chain
                    <span aria-hidden="true">→</span>
                  </a>
                </div>
                <img
                  className="hero__image"
                  src="/tessera_compute_illustration.svg"
                  alt="How a Tessera rental settles: the renter selects compute and pays per block before it runs; the provider is paid directly with no credit or risk; while the current block runs, the next block is already purchased (the lookahead window)."
                />
              </div>

              <div className="page-layout">
              <div className="page-main">
                <section className="section">
                  <div className="section__title">
                    <SectionIcon path={ICON.market} />
                    <h2>Available Machines</h2>
                  </div>
                  <p className="section__sub">
                    {identity
                      ? "Pick a machine and choose how many blocks to buy."
                      : "Connect a renter agent to rent one."}
                  </p>

                  {offline ? (
                    <Banner kind="danger" title="Can't reach the registry">
                      Start it with <code>node packages/control-plane/dist/index.js</code>, then
                      this page will pick it up automatically.
                    </Banner>
                  ) : (
                    <MachineList
                      machines={machines}
                      loaded={loaded}
                      canRent={identity !== undefined}
                      rentingId={rentingId}
                      onRent={(m) => setRentingId(m.machineId)}
                    />
                  )}
                </section>

                {loaded && !offline && (
                  <section className="section">
                    <div className="section__head">
                      <div className="section__title">
                        <SectionIcon path={ICON.jobs} />
                        <h2>Jobs on this marketplace</h2>
                      </div>
                      {identity && (
                        <a href={hrefFor({ name: "renter", renterId: identity.accountId })}>
                          My rentals
                        </a>
                      )}
                    </div>
                    <p className="section__sub">
                      Every placement the registry currently knows about. Renting happens from
                      the SDK or a renter agent, never from this page — what shows up here
                      already happened.
                    </p>
                    <div className="card panel">
                      <JobList jobs={jobs} />
                    </div>
                  </section>
                )}
              </div>

              {loaded && !offline && machines.length > 0 && (
                <aside className="page-aside">
                  <div className="stat-card">
                    <p className="stat-card__title">Marketplace stats</p>
                    <dl className="stat-card__grid">
                      <div className="stat-card__tile">
                        <dt className="stat-card__label">Providers</dt>
                        <dd className="stat-card__value">{stats.providers}</dd>
                      </div>
                      <div className="stat-card__tile">
                        <dt className="stat-card__label">Online</dt>
                        <dd className="stat-card__value">
                          <span
                            className={`stat-card__dot${stats.online === stats.total ? " stat-card__dot--all" : ""}`}
                            aria-hidden="true"
                          />
                          {stats.online}/{stats.total}
                        </dd>
                      </div>
                      <div className="stat-card__tile">
                        <dt className="stat-card__label">Cheapest block</dt>
                        <dd className="stat-card__value">{stats.cheapest ?? "—"}</dd>
                      </div>
                      <div className="stat-card__tile">
                        <dt className="stat-card__label">Active jobs</dt>
                        <dd className="stat-card__value">{jobs.length}</dd>
                      </div>
                    </dl>
                  </div>
                </aside>
              )}
              </div>
            </>
          )}
        </div>
      </main>

      {rentingId &&
        (() => {
          const machine = machines.find((m) => m.machineId === rentingId);
          if (!machine) return null;
          return (
            <Modal title={`Rent ${machine.machineId}`} onClose={() => setRentingId(undefined)}>
              <RentForm
                machine={machine}
                renterUrl={renterUrl}
                onCancel={() => setRentingId(undefined)}
                onRented={(job) => {
                  setRentingId(undefined);
                  void load();
                  setView({ name: "job", jobId: job.jobId });
                }}
              />
            </Modal>
          );
        })()}
    </>
  );
}
