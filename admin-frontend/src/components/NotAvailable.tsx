interface NotAvailableProps {
  reason: string;
}

// Distinct from PlaceholderView (whole-page phase gating): this is for a
// section within an otherwise-live screen whose data the real n8n feed does
// not provide (plan section 4.3 - render "not scored yet"/placeholder
// rather than fabricate). Always shown with the reason as visible text, not
// just a visual treatment.
export function NotAvailable({ reason }: NotAvailableProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-[13px] text-ink-faint">
      Not available - {reason}
    </div>
  );
}
