'use client';

import { FileText, Wand2 } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { CopyButton } from '../../components/copy-button';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import {
  generateCopy,
  listProductsFromDispatches,
  type CopyResponse,
  type DashboardProduct,
} from '../../lib/api';

const toPublicMessage = (copy: CopyResponse) =>
  [copy.titulo, copy.mensagem, copy.cta, copy.hashtags]
    .filter(Boolean)
    .join('\n\n');

export default function CopiesPage() {
  const [productId, setProductId] = useState('');
  const [products, setProducts] = useState<DashboardProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currentCopy, setCurrentCopy] = useState<CopyResponse | null>(null);
  const [history, setHistory] = useState<
    Array<{ productId: string; copy: CopyResponse }>
  >([]);

  useEffect(() => {
    const load = async () => {
      try {
        setProducts(await listProductsFromDispatches());
      } catch {
        setProducts([]);
      } finally {
        setLoadingProducts(false);
      }
    };
    void load();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !productId.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const copy = await generateCopy(productId.trim());
      setCurrentCopy(copy);
      setHistory((current) => [{ productId: productId.trim(), copy }, ...current]);
      setSuccess('Copy gerada com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Copies"
        description="Gere copy manual com POST /copy/generate. O historico abaixo existe somente durante esta sessao de tela."
      />

      <form
        onSubmit={submit}
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <label>
            <span className="text-sm font-medium text-slate-700">Product ID</span>
            <input
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="ID do produto"
            />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">
              Selecionar produto conhecido
            </span>
            <select
              value=""
              onChange={(event) => setProductId(event.target.value)}
              disabled={loadingProducts || products.length === 0}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">
                {loadingProducts
                  ? 'Carregando...'
                  : products.length === 0
                    ? 'Nenhum produto em dispatches'
                    : 'Escolha um produto'}
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.nome}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={submitting || !productId.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Wand2 className="h-4 w-4" aria-hidden="true" />
            {submitting ? 'Gerando...' : 'Gerar copy'}
          </button>
        </div>
      </form>

      {submitting ? <LoadingState label="Gerando copy" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          {success}
        </div>
      ) : null}

      {currentCopy ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-slate-500" aria-hidden="true" />
              <h2 className="font-semibold text-slate-950">Copy gerada</h2>
            </div>
            <CopyButton value={toPublicMessage(currentCopy)} label="Copiar tudo" />
          </div>
          <dl className="mt-5 grid gap-4">
            <div>
              <dt className="text-sm font-medium text-slate-500">Titulo</dt>
              <dd className="mt-1 text-slate-950">{currentCopy.titulo}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">Mensagem</dt>
              <dd className="mt-1 whitespace-pre-wrap leading-6 text-slate-950">
                {currentCopy.mensagem}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">CTA</dt>
              <dd className="mt-1 text-slate-950">{currentCopy.cta}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">Hashtags</dt>
              <dd className="mt-1 text-slate-950">{currentCopy.hashtags}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <EmptyState
          title="Nenhuma copy gerada nesta sessao"
          description="Informe um productId existente e execute a geracao manual."
        />
      )}

      {history.length > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-950">Historico da sessao</h2>
          <div className="mt-4 grid gap-3">
            {history.map((item, index) => (
              <article
                key={`${item.productId}-${index}`}
                className="rounded-md border border-slate-200 p-3"
              >
                <p className="break-all text-xs text-slate-500">
                  Produto: {item.productId}
                </p>
                <p className="mt-2 font-medium text-slate-950">
                  {item.copy.titulo}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

