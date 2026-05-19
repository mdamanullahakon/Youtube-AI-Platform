export default function DashboardLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-48 bg-card-border rounded" />
          <div className="h-4 w-64 bg-card-border rounded mt-2" />
        </div>
        <div className="h-10 w-40 bg-card-border rounded-xl" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glow-card rounded-xl p-5">
            <div className="h-4 w-24 bg-card-border rounded mb-3" />
            <div className="h-8 w-16 bg-card-border rounded" />
          </div>
        ))}
      </div>
      <div className="glow-card rounded-xl p-6">
        <div className="h-48 bg-card-border rounded" />
      </div>
    </div>
  );
}
