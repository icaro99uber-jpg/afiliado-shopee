'use client';

import {
  CheckCircle2,
  ClipboardCheck,
  History,
  PackageCheck,
  PlayCircle,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CopyButton } from '../../components/copy-button';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import {
  listCommercialPipelineRuns,
  runCommercialPipelineDryRun,
  type CommercialPipelineDryRunResult,
  type CommercialPipelineInput,
  type CommercialPipelineRun,
} from '../../lib/api';

type FormState = {
  source: 'MOCK' | 'MANUAL';
  categoryId: string;
  minPrice: string;
  maxPrice: string;
  minDiscountRate: string;
  minRating: string;
  minSales: string;
  minCommissionRate: string;
  minimumScore: string;
  campaign: string;
  limitCandidates: string;
};

const initialForm: FormState = {
  source: 'MOCK',
  categoryId: '',
  minPrice: '',
  maxPrice: '',
  minDiscountRate: '',
  minRating: '',
  minSales: '',
  minCommissionRate: '',
  minimumScore: '70',
  campaign: 'teste-local',
  limitCandidates: '20',
};

const numericFields = [
  ['minPrice', 'Preco minimo'],
  ['maxPrice', 'Preco maximo'],
  ['minDiscountRate', 'Desconto minimo (%)'],
  ['minRating', 'Avaliacao minima'],
  ['minSales', 'Vendas minimas'],
  ['minCommissionRate', 'Comissao minima (%)'],
  ['minimumScore', 'Score minimo'],
  ['limitCandidates', 'Limite de candidatos'],
] as const;

const toInput = (form: FormState): CommercialPipelineInput => {
  const input: CommercialPipelineInput = {
    source: form.source,
    campaign: form.campaign.trim() || undefined,
    categoryId: form.categoryId.trim() || undefined,
  };
  for (const [field] of numericFields) {
    if (!form[field]) continue;
    input[field] = Number(form[field]);
  }
  return input;
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));

const rejectionLabels: Record<string, string> = {
  MISSING_AFFILIATE_LINK: 'Sem link afiliado',
  INVALID_AFFILIATE_LINK: 'Link afiliado invalido',
  OFFER_EXPIRED: 'Oferta expirada',
  OFFER_UNAVAILABLE: 'Oferta indisponivel',
  OFFER_NOT_STARTED: 'Oferta ainda nao iniciada',
  SCORE_BELOW_MINIMUM: 'Score abaixo do minimo',
  ALREADY_SENT_TO_GROUP: 'Ja enviado ao grupo',
  INVALID_PRODUCT_NAME: 'Nome invalido',
  INVALID_PRICE: 'Preco invalido',
  INVALID_IMAGE: 'Imagem invalida',
  INVALID_SHOP: 'Loja invalida',
  INVALID_RATING: 'Avaliacao invalida',
  INVALID_SALES: 'Vendas invalidas',
  INVALID_COMMISSION_RATE: 'Comissao invalida',
};

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export default function CommercialPipelinePage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [result, setResult] = useState<CommercialPipelineDryRunResult | null>(
    null,
  );
  const [runs, setRuns] = useState<CommercialPipelineRun[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [running, setRunning] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const response = await listCommercialPipelineRuns();
      setRuns(response.items);
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : 'Erro inesperado.',
      );
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const execute = async () => {
    if (running) return;
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      const response = await runCommercialPipelineDryRun(toInput(form));
      setResult(response);
      await loadHistory();
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Erro inesperado.');
      await loadHistory();
    } finally {
      setRunning(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void execute();
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Pipeline comercial"
        description="Selecione um produto e um unico grupo autorizado, gere a copy final e audite o plano sem criar dispatch, job ou mensagem."
        actions={<StatusBadge tone="warning">Somente dry-run</StatusBadge>}
      />

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Preparacao comercial segura</p>
            <p className="mt-1 leading-6">
              Nenhuma mensagem foi enviada. Cupons nao fazem parte deste fluxo,
              e o link afiliado persistido nao e modificado.
            </p>
          </div>
        </div>
      </div>

      <form
        onSubmit={submit}
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label>
            <span className="text-sm font-medium text-slate-700">Provider</span>
            <select
              value={form.source}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  source: event.target.value as 'MOCK' | 'MANUAL',
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="MOCK">Mock</option>
              <option value="MANUAL">Manual</option>
            </select>
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">
              Categoria
            </span>
            <input
              value={form.categoryId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  categoryId: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="ID opcional"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">Campanha</span>
            <input
              value={form.campaign}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  campaign: event.target.value,
                }))
              }
              maxLength={80}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </label>
          {numericFields.map(([field, label]) => (
            <label key={field}>
              <span className="text-sm font-medium text-slate-700">
                {label}
              </span>
              <input
                type="number"
                min="0"
                step={
                  field === 'minSales' || field === 'limitCandidates'
                    ? '1'
                    : '0.01'
                }
                value={form[field]}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    [field]: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </label>
          ))}
        </div>
        <button
          type="submit"
          disabled={running}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <PlayCircle className="h-4 w-4" aria-hidden="true" />
          {running ? 'Preparando preview...' : 'Executar dry-run'}
        </button>
      </form>

      {running ? <LoadingState label="Executando pipeline comercial" /> : null}
      {runError ? (
        <ErrorState
          title="Dry-run bloqueado"
          message={runError}
          onRetry={() => void execute()}
        />
      ) : null}

      {!running && !runError && !result ? (
        <EmptyState
          title="Nenhum preview nesta sessao"
          description="Ajuste os filtros e execute um dry-run. O resultado sera registrado no historico sem envio."
        />
      ) : null}

      {result ? (
        <section className="grid gap-5" aria-label="Resultado do dry-run">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard label="Candidatos" value={result.candidateCount} />
            <SummaryCard label="Elegiveis" value={result.eligibleCount} />
            <SummaryCard label="Rejeitados" value={result.rejectedCount} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-3">
                <PackageCheck
                  className="h-5 w-5 text-orange-600"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Produto selecionado
                  </p>
                  <h2 className="mt-1 font-semibold text-slate-950">
                    {result.selectedProduct.name}
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    R${' '}
                    {Number(result.selectedProduct.price).toLocaleString(
                      'pt-BR',
                      { minimumFractionDigits: 2 },
                    )}
                    {' · '}Score {result.selectedProduct.score}
                  </p>
                </div>
              </div>
            </article>
            <article className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-3">
                <Users className="h-5 w-5 text-orange-600" aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Grupo autorizado
                  </p>
                  <h2 className="mt-1 font-semibold text-slate-950">
                    {result.selectedGroup.name}
                  </h2>
                  <p className="mt-2 font-mono text-xs text-slate-600">
                    {result.selectedGroup.fingerprint}
                  </p>
                </div>
              </div>
            </article>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
            <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Preview final
                  </p>
                  <h2 className="mt-1 font-semibold text-slate-950">
                    Mensagem nao enviada
                  </h2>
                </div>
                <CopyButton value={result.copyPreview} label="Copiar preview" />
              </div>
              <pre className="mt-4 whitespace-pre-wrap break-words rounded-md bg-slate-950 p-4 text-sm leading-6 text-slate-50">
                {result.copyPreview}
              </pre>
            </article>
            <div className="grid gap-4">
              <article className="rounded-lg border border-slate-200 bg-white p-5">
                <h2 className="font-semibold text-slate-950">
                  Motivos da escolha
                </h2>
                <ul className="mt-3 grid gap-2 text-sm text-slate-600">
                  {result.selectionReasons.map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                        aria-hidden="true"
                      />
                      {reason}
                    </li>
                  ))}
                </ul>
              </article>
              <article className="rounded-lg border border-slate-200 bg-white p-5">
                <h2 className="font-semibold text-slate-950">
                  Sub_ids planejados
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.plannedSubIds.map((subId, index) => (
                    <code
                      key={`${index}-${subId}`}
                      className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700"
                    >
                      {subId}
                    </code>
                  ))}
                </div>
              </article>
            </div>
          </div>

          {Object.keys(result.rejectionSummary).length > 0 ? (
            <article className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="font-semibold text-slate-950">
                Resumo de rejeicoes
              </h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(result.rejectionSummary).map(
                  ([code, count]) => (
                    <div
                      key={code}
                      className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span className="text-slate-700">
                        {rejectionLabels[code] ?? code}
                      </span>
                      <strong className="text-slate-950">{count}</strong>
                    </div>
                  ),
                )}
              </div>
            </article>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-4">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-slate-600" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-slate-950">
            Historico de dry-runs
          </h2>
        </div>
        {loadingHistory ? <LoadingState label="Carregando historico" /> : null}
        {historyError ? (
          <ErrorState
            message={historyError}
            onRetry={() => void loadHistory()}
          />
        ) : null}
        {!loadingHistory && !historyError && runs.length === 0 ? (
          <EmptyState
            title="Historico vazio"
            description="As execucoes dry-run aparecerao aqui para auditoria."
          />
        ) : null}
        {!loadingHistory && !historyError && runs.length > 0 ? (
          <div className="grid gap-3">
            {runs.map((run) => (
              <article
                key={run.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <ClipboardCheck
                        className="h-4 w-4 text-slate-500"
                        aria-hidden="true"
                      />
                      <StatusBadge
                        tone={
                          run.status === 'completed'
                            ? 'ok'
                            : run.status === 'blocked'
                              ? 'warning'
                              : 'error'
                        }
                      >
                        {run.status}
                      </StatusBadge>
                      <span className="text-xs text-slate-500">
                        {formatDate(run.createdAt)}
                      </span>
                    </div>
                    <p className="mt-3 truncate font-medium text-slate-950">
                      {run.selectedProduct?.name ??
                        run.failureCode ??
                        'Execucao iniciada'}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {run.selectedGroup
                        ? `${run.selectedGroup.name} · ${run.selectedGroup.fingerprint}`
                        : 'Grupo nao selecionado'}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center text-xs text-slate-600 sm:min-w-56">
                    <div>
                      <strong className="block text-base text-slate-950">
                        {run.candidateCount}
                      </strong>
                      Candidatos
                    </div>
                    <div>
                      <strong className="block text-base text-slate-950">
                        {run.rejectedCount}
                      </strong>
                      Rejeitados
                    </div>
                    <div>
                      <strong className="block text-base text-slate-950">
                        {run.selectedProduct?.score ?? '—'}
                      </strong>
                      Score
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
