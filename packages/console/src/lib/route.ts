import { useEffect, useState } from "react";

export type Route =
  | { name: "marketplace" }
  | { name: "ledger" }
  | { name: "about" }
  | { name: "job"; jobId: string }
  | { name: "renter"; renterId: string };

/**
 * Hash routing, so a running job has a URL.
 *
 * Worth the twenty lines: watching a settlement stream is the thing people
 * will want to send each other, and "open the console, then find the job in
 * the list" is not a link.
 */
export function parseHash(hash: string): Route {
  const job = /^#\/job\/([^/?#]+)$/.exec(hash);
  if (job?.[1]) return { name: "job", jobId: decodeURIComponent(job[1]) };

  const renter = /^#\/renter\/([^/?#]+)$/.exec(hash);
  if (renter?.[1]) return { name: "renter", renterId: decodeURIComponent(renter[1]) };

  if (hash === "#/ledger") return { name: "ledger" };
  if (hash === "#/about") return { name: "about" };

  return { name: "marketplace" };
}

export function hrefFor(route: Route): string {
  if (route.name === "job") return `#/job/${encodeURIComponent(route.jobId)}`;
  if (route.name === "renter") return `#/renter/${encodeURIComponent(route.renterId)}`;
  if (route.name === "ledger") return "#/ledger";
  if (route.name === "about") return "#/about";
  return "#/";
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return [route, (next) => {
    window.location.hash = hrefFor(next);
  }];
}
