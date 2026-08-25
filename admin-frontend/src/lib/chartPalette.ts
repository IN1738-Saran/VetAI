// Categorical palette for multi-bar charts (top roles / candidates by job),
// sampled from the reference screenshots (VetAI-02-Dashboard.png,
// VetAI-06-Analytics.png): each bar cycles through a varied set of brand
// tones rather than rendering everything in one flat color - that flatness
// was the actual bug being fixed here (every bar previously rendered navy,
// reading as "almost all black").
export const CHART_PALETTE = [
  '#0B1A2C', // navy
  '#2563EB', // blue
  '#3B82F6', // lighter blue
  '#F2A93E', // amber
  '#F5C878', // lighter amber
  '#16A34A', // green
  '#15803D', // darker green
  '#9CA3AF', // gray (used for an "Other" bucket)
];

export function paletteColor(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}
