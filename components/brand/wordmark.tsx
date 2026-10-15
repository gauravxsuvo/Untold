type WordmarkProps = {
  compact?: boolean;
};

export function Wordmark({ compact = false }: WordmarkProps) {
  return (
    <span className={`wordmark${compact ? " wordmark--compact" : ""}`}>
      <svg
        aria-hidden="true"
        className="wordmark__symbol"
        fill="currentColor"
        viewBox="0 0 100 100"
      >
        <path
          d="M26 20H34C41 20 46 25 46 32V76L32 62H26C18 62 12 56 12 48V34C12 26 18 20 26 20Z"
        />
        <path
          d="M74 20H66C59 20 54 25 54 32V76L68 62H74C82 62 88 56 88 48V34C88 26 82 20 74 20Z"
        />
      </svg>
      {!compact && <span className="wordmark__name">untold</span>}
      {compact && <span className="sr-only">Untold</span>}
    </span>
  );
}
