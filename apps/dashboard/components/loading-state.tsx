type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = 'Carregando dados' }: LoadingStateProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="mt-4 grid gap-3">
        <div className="h-4 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
      </div>
    </div>
  );
}

