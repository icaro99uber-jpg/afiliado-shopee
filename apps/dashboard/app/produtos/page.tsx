'use client';

import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { listProductsFromDispatches, type DashboardProduct } from '../../lib/api';
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
} from '../../lib/format';

type SortKey = 'score' | 'preco' | 'vendidos' | 'comissao';

const PAGE_SIZE = 10;

export default function ProductsPage() {
  const [products, setProducts] = useState<DashboardProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [scoreMin, setScoreMin] = useState('');
  const [ratingMin, setRatingMin] = useState('');
  const [sort, setSort] = useState<SortKey>('score');
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await listProductsFromDispatches());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, category, scoreMin, ratingMin, sort]);

  const categories = useMemo(
    () => Array.from(new Set(products.map((product) => product.categoria))).sort(),
    [products],
  );

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const scoreValue = Number(scoreMin);
    const ratingValue = Number(ratingMin);

    return products
      .filter((product) => {
        const matchesSearch =
          !normalizedSearch ||
          product.nome.toLowerCase().includes(normalizedSearch) ||
          product.loja.toLowerCase().includes(normalizedSearch);
        const matchesCategory = !category || product.categoria === category;
        const matchesScore =
          !scoreMin ||
          (typeof product.score === 'number' && product.score >= scoreValue);
        const matchesRating = !ratingMin || product.nota >= ratingValue;
        return (
          matchesSearch && matchesCategory && matchesScore && matchesRating
        );
      })
      .sort((a, b) => Number(b[sort] ?? 0) - Number(a[sort] ?? 0));
  }, [category, products, ratingMin, scoreMin, search, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Produtos"
        description="Catalogo derivado de GET /whatsapp/dispatches. A API atual nao expoe uma listagem completa de produtos."
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        Nao disponivel: endpoint publico para listar todos os produtos. Esta tela
        mostra apenas produtos vinculados a dispatches existentes.
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Busca</span>
            <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-300 px-3 focus-within:ring-2 focus-within:ring-orange-500">
              <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full border-0 bg-transparent py-2 text-sm outline-none"
                placeholder="Nome ou loja"
              />
            </div>
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Categoria</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">Todas</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Score min.</span>
            <input
              type="number"
              min="0"
              max="100"
              value={scoreMin}
              onChange={(event) => setScoreMin(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">Nota min.</span>
            <input
              type="number"
              min="0"
              max="5"
              step="0.1"
              value={ratingMin}
              onChange={(event) => setRatingMin(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </label>
        </div>
        <label className="mt-3 block max-w-xs">
          <span className="text-sm font-medium text-slate-700">Ordenar por</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="score">Score</option>
            <option value="preco">Preco</option>
            <option value="vendidos">Vendidos</option>
            <option value="comissao">Comissao</option>
          </select>
        </label>
      </section>

      {loading ? <LoadingState label="Carregando produtos disponiveis" /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {!loading && !error && visible.length === 0 ? (
        <EmptyState
          title="Nenhum produto para exibir"
          description="Nao ha produtos nos dispatches atuais ou os filtros locais removeram todos os resultados."
        />
      ) : null}

      {visible.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Preco</th>
                  <th className="px-4 py-3">Desconto</th>
                  <th className="px-4 py-3">Nota</th>
                  <th className="px-4 py-3">Vendidos</th>
                  <th className="px-4 py-3">Comissao</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Loja</th>
                  <th className="px-4 py-3">Atualizacao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visible.map((product) => (
                  <tr key={product.id} className="align-top">
                    <td className="max-w-xs px-4 py-3 font-medium text-slate-950">
                      {product.nome}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{product.categoria}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatCurrency(product.preco)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatPercent(product.desconto)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{product.nota}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatNumber(product.vendidos)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatPercent(product.comissao)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone="neutral">{product.score ?? '—'}</StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{product.loja}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDateTime(product.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {visible.map((product) => (
              <article
                key={product.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-950">{product.nome}</h2>
                    <p className="mt-1 text-sm text-slate-600">{product.loja}</p>
                  </div>
                  <StatusBadge tone="neutral">{product.score ?? '—'}</StatusBadge>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-slate-500">Categoria</dt>
                    <dd className="font-medium">{product.categoria}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Preco</dt>
                    <dd className="font-medium">{formatCurrency(product.preco)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Nota</dt>
                    <dd className="font-medium">{product.nota}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Vendidos</dt>
                    <dd className="font-medium">{formatNumber(product.vendidos)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Pagina {page} de {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
                disabled={page === totalPages}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Proxima
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

