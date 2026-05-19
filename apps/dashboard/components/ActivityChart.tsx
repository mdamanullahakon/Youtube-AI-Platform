'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ActivityChartProps {
  data?: { name: string; views: number; likes: number }[];
}

export function ActivityChart({ data }: ActivityChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="glow-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4">Activity Overview</h3>
        <div className="h-64 flex items-center justify-center text-muted text-sm">
          No activity data yet. Upload your first video to see analytics.
        </div>
      </div>
    );
  }

  return (
    <div className="glow-card rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-4">Activity Overview</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a24" />
            <XAxis dataKey="name" stroke="#71717a" fontSize={12} />
            <YAxis stroke="#71717a" fontSize={12} />
            <Tooltip
              contentStyle={{
                background: '#111118',
                border: '1px solid #1a1a24',
                borderRadius: '8px',
                color: '#ededed',
              }}
            />
            <Line type="monotone" dataKey="views" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="likes" stroke="#06b6d4" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
