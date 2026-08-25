interface NotAvailableProps {
  /** A complete, plain-language sentence - no prefix is added, so write it as one. */
  reason: string;
}

// For a section within an otherwise-live screen that has nothing to show yet.
// The dashed border/muted styling is the "this isn't live content" signal,
// so `reason` is rendered as-is, in plain, professional language - not
// prefixed with "Not available -" (which read as an error to end users)
// and never naming internal implementation details.
export function NotAvailable({ reason }: NotAvailableProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-[13px] text-ink-faint">
      {reason}
    </div>
  );
}
