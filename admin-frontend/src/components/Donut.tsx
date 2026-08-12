import type { ReactNode } from 'react';
import { PieChart, Pie, Cell } from 'recharts';

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface DonutProps {
  slices: DonutSlice[];
  centerLabel: ReactNode;
  centerValue: ReactNode;
}

export function Donut({ slices, centerLabel, centerValue }: DonutProps) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-[180px] w-[180px]">
        <PieChart width={180} height={180}>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            innerRadius={62}
            outerRadius={86}
            paddingAngle={2}
            stroke="none"
          >
            {slices.map((slice) => (
              <Cell key={slice.label} fill={slice.color} />
            ))}
          </Pie>
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-bold text-ink">{centerValue}</div>
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">{centerLabel}</div>
        </div>
      </div>

      <ul className="w-full space-y-1.5 text-[13px]">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-ink">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: slice.color }} />
              {slice.label}
            </span>
            <span className="text-ink-muted">
              {slice.value} - {total > 0 ? Math.round((slice.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
