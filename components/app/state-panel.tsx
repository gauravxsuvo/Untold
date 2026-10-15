import Link from "next/link";
import { ArrowUpRight, CircleDashed, CircleX, TriangleAlert } from "lucide-react";

type StatePanelProps = {
  kind: "empty" | "unavailable" | "error";
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
};

const stateLabels = {
  empty: "Nothing here yet",
  unavailable: "Not available right now",
  error: "This section could not load",
} as const;

const stateIcons = {
  empty: CircleDashed,
  unavailable: TriangleAlert,
  error: CircleX,
} as const;

export function StatePanel({
  kind,
  title,
  description,
  actionLabel,
  actionHref,
}: StatePanelProps) {
  const StateIcon = stateIcons[kind];

  return (
    <section aria-labelledby="state-panel-title" className={`state-panel state-panel--${kind}`}>
      <div aria-hidden="true" className="state-panel__mark">
        <StateIcon size={23} strokeWidth={1.7} />
      </div>
      <p className="state-panel__label">{stateLabels[kind]}</p>
      <h2 id="state-panel-title">{title}</h2>
      <p className="state-panel__description">{description}</p>
      {actionLabel && actionHref ? (
        <Link className="state-panel__link" href={actionHref}>
          {actionLabel}
          <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.8} />
        </Link>
      ) : null}
    </section>
  );
}
