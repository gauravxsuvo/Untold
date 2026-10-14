type WordmarkProps = {
  compact?: boolean;
};

export function Wordmark({ compact = false }: WordmarkProps) {
  return (
    <span className={`wordmark${compact ? " wordmark--compact" : ""}`}>
      <svg
        aria-hidden="true"
        className="wordmark__symbol"
        fill="none"
        viewBox="0 0 36 36"
      >
        <path
          d="M10.25 7.75h12.5a5.5 5.5 0 0 1 5.5 5.5v6a5.5 5.5 0 0 1-5.5 5.5h-2.5l-5.5 4v-4h-4.5a5.5 5.5 0 0 1-5.5-5.5v-6a5.5 5.5 0 0 1 5.5-5.5Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M12 14.5h9m-9 4h5.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
      {!compact && <span className="wordmark__name">untold</span>}
      <span className="sr-only">Untold</span>
    </span>
  );
}
