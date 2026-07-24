type MetricCardProps = {
  title: string;
  value: React.ReactNode;
  description?: string;
};

export function MetricCard({ title, value, description }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
      {description ? (
        <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
      ) : null}
    </div>
  );
}

