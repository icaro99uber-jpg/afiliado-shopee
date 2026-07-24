'use client';

import { ClipboardList, PlayCircle, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  getHealth,
  listDestinations,
  listDispatches,
  type WhatsAppDestination,
  type WhatsAppDispatch,
} from '../lib/api';
import { EmptyState } from '../components/empty-state';
import { ErrorState } from '../components/error-state';
import { LoadingState } from '../components/loading-state';
import { MetricCard } from '../components/metric-card';
import { PageHeader } from '../components/page-header';
import { StatusBadge } from '../components/status-badge';

type OverviewState = {
  apiOnline: boolean;
  destinations: WhatsAppDestination[];
  dispatches: WhatsAppDispatch[];
};

export default function OverviewPage() {
  const [data, setData] = useState<OverviewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [health, destinations, dispatches] = await Promise.all([
        getHealth(),
        listDestinations(),
        listDispatches(),
      ]);
      setData({
        apiOnline: health.status === 'ok',
        destinations,
        dispatches,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLastJobId(sessionStorage.getItem('lastPipelineJobId'));
    void load();
  }, []);

  const dispatchSummary = useMemo(() => {
    const dispatches = data?.dispatches ?? [];
    return {
      pending: dispatches.filter((dispatch) => dispatch.status === 'PENDING')
        .length,
      sent: dispatches.filter((dispatch) => dispatch.status === 'SENT').length,
      failed: dispatches.filter((dispatch) => dispatch.status === 'FAILED')
        .length,
      activeDestinations:
        data?.destinations.filter((destination) => destination.active).length ??
        0,
    };
  }, [data]);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Visao geral"
        description="Acompanhe a saude da API e os dados operacionais disponiveis pelos endpoints atuais."
        actions={
          <>
            <Link
              href="/pipeline"
              className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              Executar pipeline
            </Link>
            <Link
              href="/whatsapp"
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Cadastrar destino
            </Link>
          </>
        }
      />

      {loading ? <LoadingState label="Carregando resumo operacional" /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {data && !loading ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Produtos encontrados"
              value="—"
              description="Nao ha endpoint publico de listagem ou metricas de produtos."
            />
            <MetricCard
              title="Produtos pontuados"
              value="—"
              description="Sem endpoint agregado para score no estado atual."
            />
            <MetricCard
              title="Produtos aprovados"
              value="—"
              description="Aprovacao existe no pipeline, mas nao ha consulta agregada."
            />
            <MetricCard
              title="Copies geradas"
              value="—"
              description="A API gera copy manualmente, mas nao lista historico."
            />
            <MetricCard
              title="Envios enfileirados"
              value={dispatchSummary.pending}
              description="Dispatches com status PENDING."
            />
            <MetricCard
              title="Envios enviados"
              value={dispatchSummary.sent}
              description="Dispatches com status SENT."
            />
            <MetricCard
              title="Envios com falha"
              value={dispatchSummary.failed}
              description="Dispatches com status FAILED."
            />
            <MetricCard
              title="Destinos ativos"
              value={dispatchSummary.activeDestinations}
              description="Destinos WhatsApp ativos cadastrados."
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-950">Estado da API</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Consulta feita contra o endpoint GET /health.
                  </p>
                </div>
                <StatusBadge tone={data.apiOnline ? 'ok' : 'error'}>
                  {data.apiOnline ? 'online' : 'offline'}
                </StatusBadge>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="font-semibold text-slate-950">Ultimo job da sessao</h2>
              <p className="mt-2 break-all text-sm text-slate-600">
                {lastJobId ?? 'Nenhum job iniciado ou consultado nesta sessao.'}
              </p>
            </div>
          </section>

          {data.dispatches.length === 0 ? (
            <EmptyState
              title="Nenhum dispatch encontrado"
              description="Quando o pipeline criar dispatches para destinos ativos, o resumo de status aparece aqui."
            />
          ) : (
            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-slate-500" />
                <h2 className="font-semibold text-slate-950">
                  Resumo dos dispatches
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatusBadge status="PENDING">PENDING: {dispatchSummary.pending}</StatusBadge>
                <StatusBadge status="SENT">SENT: {dispatchSummary.sent}</StatusBadge>
                <StatusBadge status="FAILED">FAILED: {dispatchSummary.failed}</StatusBadge>
              </div>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
