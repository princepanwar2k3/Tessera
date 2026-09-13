import { useEffect, useState } from "react";

export type Route = { name: "home" } | { name: "job"; jobId: string };

/**
 * Hash routing, so a running job has a URL.
 *
 * Worth the twenty lines: watching a settlement stream is the thing people
 * will want to send each other, and "open the console, then find the job in
 * the list" is not a link.
 */
export function parseHash(hash: string): Route {
  const match = /^#\/job\/([^/?#]+)$/.exec(hash);
  return match?.[1] ? { name: "job", jobId: decodeURIComponent(match[1]) } : { name: "home" };
}

export function hrefFor(route: Route): string {
  return route.name === "job" ? `#/job/${encodeURIComponent(route.jobId)}` : "#/";
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
