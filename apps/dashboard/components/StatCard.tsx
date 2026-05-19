interface StatCardProps {
  title: string;
  value: string | number;
  icon: string;
  trend?: string;
  loading?: boolean;
}

export function StatCard({ title, value, icon, trend, loading }: StatCardProps) {
  if (loading) {
    return (
      <div className="stat-card animate-pulse">
        <div className="h-4 bg-card-border rounded w-24 mb-3" />
        <div className="h-8 bg-card-border rounded w-16 mb-2" />
        <div className="h-3 bg-card-border rounded w-20" />
      </div>
    );
  }

  return (
    <div className="stat-card animate-in">
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        {trend && (
          <span className={`text-xs font-medium ${trend.startsWith('+') ? 'text-green-400' : 'text-red-400'}`}>
            {trend}
          </span>
        )}
      </div>
      <p className="text-sm text-muted">{title}</p>
      <p className="text-2xl font-bold mt-1">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  );
}
