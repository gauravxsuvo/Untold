export function LoadingSkeleton({
  kind = "list",
  label = "Loading…",
  rows = 4,
}: {
  kind?: "list" | "thread" | "profile" | "page";
  label?: string;
  rows?: number;
}) {
  return (
    <div aria-busy="true" className={`loading-skeleton loading-skeleton--${kind}`} role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => ({
        id: `skeleton-${kind}-${index}`,
        variation: index % 3,
      })).map(({ id, variation }) => (
        <div
          aria-hidden="true"
          className={`loading-skeleton__row loading-skeleton__row--${variation}`}
          key={id}
        >
          {kind !== "thread" ? <span className="skeleton skeleton--avatar" /> : null}
          <span className="loading-skeleton__lines">
            <span className="skeleton skeleton--title" />
            <span className="skeleton skeleton--line" />
            {kind === "thread" || kind === "profile" ? (
              <span className="skeleton skeleton--short" />
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
