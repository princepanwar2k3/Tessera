/** Small line-icon glyphs shared by every section header, so "here is a new
 *  topic" always reads the same way regardless of which page it's on. */
export const ICON = {
  market: "M3 9.5 4.5 4h15L21 9.5M3 9.5v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-10M3 9.5h18M9 20.5v-6h6v6",
  jobs: "M4 7h16M4 12h16M4 17h10",
  ledger: "M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm9 0v5h5M9 13h6M9 17h6",
  info: "M12 8v4m0 4h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  history: "M12 8v4l3 3M21 12a9 9 0 1 1-9-9",
} as const;

export function SectionIcon({ path }: { path: string }) {
  return (
    <span className="section__icon">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d={path} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
