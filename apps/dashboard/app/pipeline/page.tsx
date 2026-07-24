'use client';

import { PlayCircle, Search } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CopyButton } from '../../components/copy-button';
import { ErrorState } from '../../components/error-state';
import { JobProgress } from '../../components/job-progress';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import {
  getPipelineJob,
  runPipeline,
  type PipelineJobResponse,
  type ProductFilters,
} from '../../lib/api';

const POLLING_MS = 5000;
const ACTIVE_STATES = new Set(['active', 'waiting', 'delayed', 'queued']);

type FilterForm = Record<keyof ProductFilters, string>;

const initialFilters: FilterForm = {
  categoria: '',
  precoMin: '',
  precoMax: '',
  descontoMin: '',
  notaMin: '',
  vendidosMin: '',
  comissaoMin: '',
};

const toFilters = (form: FilterForm): ProductFilters => {
  const filters: ProductFilters = {};
  for (const [key, value] of Object.entries(form)) {
    if (!value) continue;
    if (key === 'categoria') {
      filters.categoria = value;
    } else {
      filters[key as Exclude<keyof ProductFilters, 'categoria'>] =
        Number(value);
    }
  }
  return filters;
};

export default function PipelinePage() {
  const [filters, setFilters] = useState<FilterForm>(initialFilters);
  const [jobId, setJobId] = useState('');
  const [manualJobId, setManualJobId] = useState('');
  const [job, setJob] = useState<PipelineJobResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentJobIsActive = useMemo(
    () => Boolean(jobId && (!job || ACTIVE_STATES.has(job.status))),
    [job, jobId],
  );

  const consultJob = async (id: string) => {
    setChecking(true);
    setError(null);
    try {
      const response = await getPipelineJob(id);
      setJob(response);
      setJobId(id);
      sessionStorage.setItem('lastPipelineJobId', id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setChecking(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    setJob(null);
    try {
      const response = await runPipeline(toFilters(filters));
      const id = String(response.jobId ?? '');
      setJobId(id);
      setManualJobId(id);
      sessionStorage.setItem('lastPipelineJobId', id);
      setJob({
        status: response.status,
        progress: 'queued',
        startedAt: null,
        finishedAt: null,
        result: null,
        error: null,
      });
      if (id) await consultJob(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!currentJobIsActive || !jobId) return;
    const interval = window.setInterval(() => {
      void consultJob(jobId);
    }, POLLING_MS);

    return () => window.clearInterval(interval);
  }, [currentJobIsActive, jobId]);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Pipeline"
        description="Execute POST /pipeline/run com filtros comerciais e acompanhe GET /pipeline/jobs/:id sem polling agressivo."
      />

      <form
        onSubmit={submit}
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <div className="grid gap-4 md:grid-cols-4">
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Categoria</span>
            <input
              value={filters.categoria}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  categoria: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="Ex.: Eletronicos"
            />
          </label>
          {[
            ['precoMin', 'Preco minimo'],
            ['precoMax', 'Preco maximo'],
            ['descontoMin', 'Desconto minimo'],
            ['notaMin', 'Nota minima'],
            ['vendidosMin', 'Vendidos minimos'],
            ['comissaoMin', 'Comissao minima'],
          ].map(([name, label]) => (
            <label key={name}>
              <span className="text-sm font-medium text-slate-700">{label}</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={filters[name as keyof FilterForm]}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    [name]: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </label>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
            {submitting ? 'Enfileirando...' : 'Executar pipeline'}
          </button>
          {jobId ? <CopyButton value={jobId} label="Copiar jobId" /> : null}
        </div>
      </form>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (manualJobId.trim()) void consultJob(manualJobId.trim());
        }}
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <label>
          <span className="text-sm font-medium text-slate-700">
            Consultar outro jobId
          </span>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              value={manualJobId}
              onChange={(event) => setManualJobId(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="Cole o jobId"
            />
            <button
              type="submit"
              disabled={checking || !manualJobId.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Consultar
            </button>
          </div>
        </label>
      </form>

      {checking ? <LoadingState label="Consultando job" /> : null}
      {error ? <ErrorState message={error} /> : null}

      <JobProgress job={job} queuedJobId={jobId} />

      {job?.result ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-950">Resultado completo</h2>
          <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-slate-950 p-4 text-xs leading-6 text-slate-50">
            {JSON.stringify(job.result, null, 2)}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

