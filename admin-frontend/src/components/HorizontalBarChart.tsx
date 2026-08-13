import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';

export interface BarDatum {
  label: string;
  value: number;
}

interface HorizontalBarChartProps {
  data: BarDatum[];
  color?: string;
  height?: number;
}

export function HorizontalBarChart({ data, color = '#0B1A2C', height = 260 }: HorizontalBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={160}
          tick={{ fontSize: 11, fill: '#6B7280' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E7E9ED' }} cursor={{ fill: '#F4F5F7' }} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={14}>
          {data.map((_, i) => (
            <Cell key={i} fill={color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
