import React from 'react';
import GlassCard from '../components/GlassCard.jsx';
import AnalyticsChart from '../components/AnalyticsChart.jsx';
import useAnalytics from '../hooks/useAnalytics.jsx';
import './dashboard.css';

function Dashboard() {
  const { data, loading, error } = useAnalytics();

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>
      <div className="grid">
        <GlassCard title="Analytics">
          {loading && <p>Loading...</p>}
          {error && <p>Error loading data.</p>}
          {data && <AnalyticsChart data={data} />}
        </GlassCard>
        <GlassCard title="Recent Uploads">
          <p>Placeholder for recent video uploads.</p>
        </GlassCard>
        <GlassCard title="System Health">
          <p>All systems operational.</p>
        </GlassCard>
      </div>
    </div>
  );
}

export default Dashboard;
