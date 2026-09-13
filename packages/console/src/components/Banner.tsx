import type { ReactNode } from "react";

type BannerKind = "info" | "warning" | "danger";

interface Props {
  kind?: BannerKind;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

const ICON: Record<BannerKind, string> = {
  info: "i",
  warning: "!",
  danger: "✕",
};

/**
 * A condition worth stating as a fixture of the page, not a line of red text
 * at the end of a paragraph — the registry is unreachable, a job's event
 * stream broke. Use a toast instead for something transient that resolved
 * itself (a payment that succeeded, a rental that was placed).
 */
export function Banner({ kind = "info", title, children, action }: Props) {
  return (
    <div className={`banner banner--${kind}`} role={kind === "danger" ? "alert" : "status"}>
      <span className="banner__icon" aria-hidden="true">
        {ICON[kind]}
      </span>
      <div className="banner__body">
        <p className="banner__title">{title}</p>
        {children && <div className="banner__detail">{children}</div>}
      </div>
      {action && <div className="banner__action">{action}</div>}
    </div>
  );
}
