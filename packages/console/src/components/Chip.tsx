import type { ReactNode } from "react";

export type ChipTone = "success" | "warning" | "danger" | "info" | "neutral" | "outline";

interface Props {
  tone: ChipTone;
  children: ReactNode;
  dot?: boolean;
}

/** A small state pill — online/offline, in use/idle — so status reads as a
 *  shape and a color before it reads as a word. */
export function Chip({ tone, children, dot = true }: Props) {
  return (
    <span className={`chip chip--${tone}`}>
      {dot && <span className="chip__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
