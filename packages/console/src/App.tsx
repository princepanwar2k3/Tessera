import { useCallback, useEffect, useState } from "react";
import { fetchJobs, fetchMachines, type Placement } from "./lib/api.js";
import type { MachineListing } from "./lib/types.js";
import { savedRenterUrl, type RenterIdentity } from "./lib/renter.js";
import { useActiveSection } from "./lib/useActiveSection.js";
import { MachineList } from "./components/MachineList.js";
import { JobList } from "./components/JobList.js";
import { JobView } from "./components/JobView.js";
import { RenterDashboard } from "./components/RenterDashboard.js";
import { Ledger } from "./components/Ledger.js";
import { RenterPanel } from "./components/RenterPanel.js";
import { RentForm } from "./components/RentForm.js";
import { Banner } from "./components/Banner.js";
import { SectionIcon, ICON } from "./components/SectionIcon.js";
import { hrefFor, useRoute } from "./lib/route.js";
import { assetLabel } from "./lib/format.js";

const NAV = [
  { id: "marketplace", label: "Marketplace" },
  { id: "jobs", label: "Jobs" },
  { id: "ledger", label: "Consensus log" },
  { id: "about", label: "How it works" },
];

function BrandMark() {
  return (
    <svg className="brandmark" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
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

  const isHome = view.name === "home";
  const active = useActiveSection(
    NAV.map((n) => n.id),
    isHome,
  );

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
        <a className="topbar__brand" href={hrefFor({ name: "home" })}>
          <BrandMark />
          <span className="topbar__name">Tessera</span>
        </a>
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

      {isHome && (
        <nav className="tabnav" aria-label="Sections">
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`}>
              {n.label}
            </a>
          ))}
        </nav>
      )}

      <div className="layout">
        {isHome && (
          <nav className="sidenav" aria-label="Sections">
            <div className="sidenav__group">
              <p className="sidenav__label">On this page</p>
              {NAV.map((n) => (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  className={`sidenav__link${active === n.id ? " sidenav__link--active" : ""}`}
                >
                  <span className="sidenav__dot" />
                  {n.label}
                </a>
              ))}
            </div>
            <p className="sidenav__note">
              Rent a machine by the block, pay before each one runs. Every settlement here is a
              real transfer on Hedera testnet.
            </p>
          </nav>
        )}

        <main className={`content${isHome ? "" : " content--full"}`}>
          <div
            className="view"
            key={
              view.name === "job"
                ? `job:${view.jobId}`
                : view.name === "renter"
                  ? `renter:${view.renterId}`
                  : "home"
            }
          >
            {view.name === "job" ? (
              <>
                <p className="breadcrumb">
                  <a href={hrefFor({ name: "home" })}>Marketplace</a>
                  <span>/</span>
                  <span className="mono">{view.jobId}</span>
                </p>
                <JobView jobId={view.jobId} renterUrl={identity ? renterUrl : undefined} />
              </>
            ) : view.name === "renter" ? (
              <>
                <p className="breadcrumb">
                  <a href={hrefFor({ name: "home" })}>Marketplace</a>
                  <span>/</span>
                  <span className="mono">{view.renterId}</span>
                </p>
                <RenterDashboard renterId={view.renterId} />
              </>
            ) : (
              <>
                <section className="section" id="marketplace">
                  <div className="section__head">
                    <div className="section__title">
                      <SectionIcon path={ICON.market} />
                      <h2>Marketplace</h2>
                    </div>
                    {identity ? (
                      <span className="empty">Pick a machine and choose how many blocks to buy.</span>
                    ) : (
                      <span className="empty">Connect a renter agent to rent one.</span>
                    )}
                  </div>
                  <p className="section__sub">
                    Every listing is a provider offering spare capacity, priced per fixed-length
                    block. Grouped by provider — the way a vendor directory is — because a machine
                    is never an anonymous slot, it belongs to whoever is running it.
                  </p>

                  {offline ? (
                    <Banner kind="danger" title="Can't reach the registry">
                      Start it with <code>node packages/control-plane/dist/index.js</code>, then
                      this page will pick it up automatically.
                    </Banner>
                  ) : (
                    <>
                      {loaded && machines.length > 0 && (
                        <div className="stat-strip">
                          <div className="stat-strip__cell">
                            <span className="stat-strip__label">Providers</span>
                            <span className="stat-strip__value">{stats.providers}</span>
                          </div>
                          <div className="stat-strip__cell">
                            <span className="stat-strip__label">Machines online</span>
                            <span className="stat-strip__value">
                              {stats.online}/{stats.total}
                            </span>
                          </div>
                          <div className="stat-strip__cell">
                            <span className="stat-strip__label">Cheapest block</span>
                            <span className="stat-strip__value">{stats.cheapest ?? "—"}</span>
                          </div>
                          <div className="stat-strip__cell">
                            <span className="stat-strip__label">Active jobs</span>
                            <span className="stat-strip__value">{jobs.length}</span>
                          </div>
                        </div>
                      )}

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
                    </>
                  )}
                </section>

                {loaded && !offline && (
                  <section className="section" id="jobs">
                    <div className="section__head">
                      <div className="section__title">
                        <SectionIcon path={ICON.jobs} />
                        <h2>Jobs on this marketplace</h2>
                      </div>
                      {identity && (
                        <a
                          className="mono-link"
                          href={hrefFor({ name: "renter", renterId: identity.accountId })}
                        >
                          yours only
                        </a>
                      )}
                    </div>
                    <p className="section__sub">
                      Every placement the registry currently knows about. Renting happens from the
                      SDK or a renter agent, never from this page — what shows up here already
                      happened.
                    </p>
                    <div className="card panel">
                      <JobList jobs={jobs} />
                    </div>
                  </section>
                )}

                <section className="section" id="ledger">
                  <Ledger />
                </section>

                <section className="section" id="about">
                  <div className="section__head">
                    <div className="section__title">
                      <SectionIcon path={ICON.info} />
                      <h2>Pay for a block before it runs</h2>
                    </div>
                  </div>
                  <div className="prose">
                    <p>
                      A container runs continuously, but payment arrives in lumps. Serving on
                      credit exposes the provider; a deposit exposes the renter. Tessera divides
                      time into fixed blocks, requires each one to be paid before it begins, and
                      opens the window to buy the next while the current one is still running.
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
              </>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
