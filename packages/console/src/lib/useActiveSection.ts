import { useEffect, useState } from "react";

/**
 * Which of these section ids is currently under the reading line, so the
 * side nav can highlight where the page actually is rather than only where a
 * click last sent it.
 */
export function useActiveSection(ids: string[], enabled: boolean): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join(",");

  useEffect(() => {
    if (!enabled) return;
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const lastId = ids[ids.length - 1];

    // A short final section can never reach the trigger band below: once the
    // page hits its scroll limit, there's nowhere further to carry it. So the
    // bottom of the page counts as "on the last section" outright, checked
    // before — and independent of — anything the observer reports.
    const atBottom = () =>
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;

    const observer = new IntersectionObserver(
      (entries) => {
        if (atBottom() && lastId) {
          setActive(lastId);
          return;
        }
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setActive(topmost.target.id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: [0, 1] },
    );

    for (const el of elements) observer.observe(el);

    const onScroll = () => {
      if (atBottom() && lastId) setActive(lastId);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return active;
}
