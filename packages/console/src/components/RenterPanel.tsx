import { useEffect, useState } from "react";
import {
  connectRenter,
  rememberRenterUrl,
  savedRenterUrl,
  type RenterIdentity,
} from "../lib/renter.js";
import { hrefFor } from "../lib/route.js";

interface Props {
  onConnected: (baseUrl: string, identity: RenterIdentity) => void;
  identity?: RenterIdentity | undefined;
  baseUrl: string;
}

/**
 * Connecting the renter's own agent — the thing that holds their key.
 *
 * Deliberately not called "connect wallet": no wallet is involved yet, and
 * naming it one would promise a popup that never comes. When a browser wallet
 * is supported this panel is where it goes, and nothing else changes.
 */
export function RenterPanel({ onConnected, identity, baseUrl }: Props) {
  const [url, setUrl] = useState(baseUrl);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const connect = async (target: string, quiet = false) => {
    setBusy(true);
    try {
      const who = await connectRenter(target);
      rememberRenterUrl(target);
      onConnected(target, who);
      setError(undefined);
    } catch (err) {
      if (!quiet) {
        setError(
          err instanceof Error && err.name === "TimeoutError"
            ? "No renter agent there. Start it with pnpm -F @bsp/renter start."
            : (err as Error).message,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  // Try the remembered address once, silently — a renter who already has the
  // agent running should not have to click anything.
  useEffect(() => {
    void connect(savedRenterUrl(), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (identity) {
    return (
      <a
        className="renter renter--on"
        href={hrefFor({ name: "renter", renterId: identity.accountId })}
      >
        <span className="renter__dot" />
        <span>
          Paying as <b className="mono">{identity.accountId}</b>
        </span>
        <span className="renter__go">your rentals</span>
      </a>
    );
  }

  return (
    <div className="renter">
      <div className="renter__row">
        <label htmlFor="renter-url">Renter agent</label>
        <input
          id="renter-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
        />
        <button className="btn" onClick={() => void connect(url)} disabled={busy}>
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
      <p className="empty">
        Your keys stay in that process. This page never sees them, and neither does the
        marketplace.
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
