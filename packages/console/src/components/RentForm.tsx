import { useEffect, useState } from "react";
import type { MachineListing } from "../lib/types.js";
import { quoteRental, rentMachine, type ActiveJob, type Quote } from "../lib/renter.js";
import { assetLabel } from "../lib/format.js";
import { Banner } from "./Banner.js";
import { useToast } from "./Toast.js";

interface Props {
  machine: MachineListing;
  renterUrl: string;
  onRented: (job: ActiveJob) => void;
  onCancel: () => void;
}

const DEFAULT_IMAGE = "tessera-demo-site:latest";

/** Choosing what to run, for how long, and seeing the bill before agreeing. */
export function RentForm({ machine, renterUrl, onRented, onCancel }: Props) {
  const [image, setImage] = useState(DEFAULT_IMAGE);
  const [blocks, setBlocks] = useState(4);
  const [port, setPort] = useState(8080);
  const [quote, setQuote] = useState<Quote | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  useEffect(() => {
    let cancelled = false;
    void quoteRental(renterUrl, machine.machineId, blocks)
      .then((q) => !cancelled && setQuote(q))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [renterUrl, machine.machineId, blocks]);

  const rent = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const job = await rentMachine(renterUrl, {
        machineId: machine.machineId,
        image,
        blocks,
        exposedPort: port,
      });
      notify("success", `Renting ${machine.machineId}`, `Block 1 paid — watching job ${job.jobId.slice(0, 12)}…`);
      onRented(job);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      notify("danger", "Rental failed", message);
    } finally {
      setBusy(false);
    }
  };

  const minutes = quote ? Math.round((quote.uptimeSeconds / 60) * 10) / 10 : 0;

  return (
    <form
      className="rent"
      onSubmit={(e) => {
        e.preventDefault();
        void rent();
      }}
    >
      <div className="rent__field">
        <label htmlFor="rent-image">Container image</label>
        <input id="rent-image" value={image} onChange={(e) => setImage(e.target.value)} spellCheck={false} />
      </div>

      <div className="rent__pair">
        <div className="rent__field">
          <label htmlFor="rent-blocks">Blocks to buy</label>
          <input
            id="rent-blocks"
            type="number"
            min={1}
            max={500}
            value={blocks}
            onChange={(e) => setBlocks(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <div className="rent__field">
          <label htmlFor="rent-port">Port it serves on</label>
          <input
            id="rent-port"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(Number(e.target.value) || 8080)}
          />
        </div>
      </div>

      {quote && (
        <dl className="rent__quote">
          <dt>Spend cap</dt>
          <dd>
            {quote.total} {assetLabel(quote.asset)}
          </dd>
          <dt>Uptime bought</dt>
          <dd>
            {quote.uptimeSeconds}s{minutes >= 1 ? ` (~${minutes} min)` : ""}
          </dd>
          <dt>Per block</dt>
          <dd>
            {quote.pricePerBlock} × {quote.blockSeconds}s
          </dd>
        </dl>
      )}

      <p className="empty">
        You are charged one block at a time and never more than the cap. Stop renewing at
        any point and the site ends at the next boundary.
      </p>

      {error && (
        <Banner kind="danger" title="Couldn't rent this machine">
          {error}
        </Banner>
      )}

      <div className="rent__actions">
        <button className="btn" type="submit" disabled={busy || !machine.live}>
          {busy ? "Paying for block 1…" : "Rent and pay"}
        </button>
        <button className="btn btn--quiet" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
