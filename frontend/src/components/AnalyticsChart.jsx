// src/components/AnalyticsChart.jsx
import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// Simple placeholder chart – expects data prop [{date, value}] or uses dummy data
export default function AnalyticsChart({ data }) {
  const chartData = data?.map((d) => ({ name: d.date, value: d.value })) || [
    { name: 'Day 1', value: 30 },
    { name: 'Day 2', value: 45 },
    { name: 'Day 3', value: 28 },
    { name: 'Day 4', value: 60 },
    { name: 'Day 5', value: 50 },
  ];

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey="value" stroke="var(--primary-color)" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
