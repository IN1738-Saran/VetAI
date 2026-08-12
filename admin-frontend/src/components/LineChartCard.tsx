import { LineChart, Line, XAxis, ResponsiveContainer, Tooltip } from 'recharts';

export interface LineChartPoint {
  label: string;
  value: number;
}

interface LineChartCardProps {
  data: LineChartPoint[];
  color?: string;
}

// Analytics-only chart; lazy-load its parent view per plan section 13
// ("chart libraries should be lazy-loaded on the Analytics view").
export function LineChartCard({ data, color = '#F2A93E' }: LineChartCardProps) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: '#9CA3AF' }}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E7E9ED' }}
          cursor={{ stroke: '#E7E9ED' }}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={{ r: 3, fill: color, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
