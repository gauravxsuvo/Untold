import Link from "next/link";

type StatePanelProps = {
  kind: "empty" | "unavailable" | "error";
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
};

const stateLabels = {
  empty: "Nothing here yet",
  unavailable: "Not available in this preview",
  error: "This section could not load",
} as const;

export function StatePanel({
  kind,
  title,
  description,
  actionLabel,
  actionHref,
}: StatePanelProps) {
  return (
    <section aria-labelledby="state-panel-title" className={`state-panel state-panel--${kind}`}>
      <div aria-hidden="true" className="state-panel__mark">
        <i />
        <i />
        <i />
      </div>
      <p className="state-panel__label">{stateLabels[kind]}</p>
      <h2 id="state-panel-title">{title}</h2>
      <p className="state-panel__description">{description}</p>
      {actionLabel && actionHref ? (
        <Link className="state-panel__link" href={actionHref}>
          {actionLabel}
          <span aria-hidden="true">↗</span>
        </Link>
      ) : null}
    </section>
  );
}
