import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { paletteColor } from '@/lib/chartPalette';

export interface BarDatum {
  label: string;
  value: number;
}

interface HorizontalBarChartProps {
  data: BarDatum[];
  /** Single color override - omit to cycle through the shared categorical palette per bar. */
  color?: string;
  height?: number;
}

const MAX_LABEL_CHARS = 22;

// recharts SVG <text> ticks don't support CSS text-overflow/ellipsis - long
// job titles (e.g. "Associate Consultant - Data Engineer / Data Analyst")
// would otherwise overflow the axis column. Truncate manually and expose the
// full label via a native <title> tooltip on hover.
function TruncatedTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const value = payload?.value ?? '';
  const truncated = value.length > MAX_LABEL_CHARS ? `${value.slice(0, MAX_LABEL_CHARS - 1)}…` : value;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="#6B7280">
      <title>{value}</title>
      {truncated}
    </text>
  );
}

export function HorizontalBarChart({ data, color, height = 260 }: HorizontalBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={150}
          tick={<TruncatedTick />}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E7E9ED' }} cursor={{ fill: '#F4F5F7' }} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={14}>
          {data.map((_, i) => (
            <Cell key={i} fill={color ?? paletteColor(i)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
