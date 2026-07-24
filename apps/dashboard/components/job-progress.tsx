import type { PipelineJobResponse } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { StatusBadge } from './status-badge';

type JobProgressProps = {
  job?: PipelineJobResponse | null;
  queuedJobId?: string;
};

export function JobProgress({ job, queuedJobId }: JobProgressProps) {
  if (!job && !queuedJobId) return null;

  const isFailed = job?.status === 'failed';
  const isDone = job?.status === 'completed';
  const progress =
    typeof job?.progress === 'number'
      ? `${job.progress}%`
      : job?.progress
        ? JSON.stringify(job.progress)
        : isDone
          ? '100%'
          : 'Aguardando processamento';

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-600">Job de pipeline</p>
          <h2 className="mt-1 break-all text-lg font-semibold text-slate-950">
            {queuedJobId ?? 'Job consultado'}
          </h2>
        </div>
        <StatusBadge tone={isFailed ? 'error' : isDone ? 'ok' : 'warning'}>
          {job?.status ?? 'queued'}
        </StatusBadge>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full ${
            isFailed ? 'bg-rose-500' : isDone ? 'bg-emerald-500' : 'bg-orange-500'
          }`}
          style={{ width: isDone ? '100%' : '45%' }}
        />
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-slate-500">Progresso</dt>
          <dd className="mt-1 font-medium text-slate-900">{progress}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Inicio</dt>
          <dd className="mt-1 font-medium text-slate-900">
            {formatDateTime(job?.startedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Fim</dt>
          <dd className="mt-1 font-medium text-slate-900">
            {formatDateTime(job?.finishedAt)}
          </dd>
        </div>
      </dl>
      {job?.error ? (
        <p className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-800">
          {job.error}
        </p>
      ) : null}
    </section>
  );
}

