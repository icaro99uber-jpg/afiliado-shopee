'use client';

import { Plus, TicketPercent, Trash2 } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import {
  createManualCoupon,
  deleteManualCoupon,
  listCoupons,
  updateManualCoupon,
  type Coupon,
  type ManualCouponInput,
} from '../../lib/api';
import { formatCurrency, formatDateTime } from '../../lib/format';

const emptyCoupon: ManualCouponInput = {
  code: '',
  description: '',
  discountType: 'PERCENTAGE',
  discountValue: '',
  minPurchase: '',
  maxDiscount: '',
  startsAt: '',
  endsAt: '',
  terms: '',
  active: true,
};

const isExpired = (coupon: Coupon) =>
  Boolean(coupon.endsAt && new Date(coupon.endsAt) <= new Date());

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [draft, setDraft] = useState<ManualCouponInput>(emptyCoupon);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setCoupons(await listCoupons());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await createManualCoupon(draft);
      setDraft(emptyCoupon);
      setSuccess('Cupom manual criado com confirmacao explicita.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleCoupon = async (coupon: Coupon) => {
    setActionId(coupon.id);
    setError(null);
    try {
      await updateManualCoupon(coupon.id, { active: !coupon.active });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setActionId(null);
    }
  };

  const removeCoupon = async (coupon: Coupon) => {
    if (!window.confirm(`Excluir o cupom manual ${coupon.code}?`)) return;
    setActionId(coupon.id);
    setError(null);
    try {
      await deleteManualCoupon(coupon.id);
      setSuccess('Cupom manual excluido.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Cupons manuais"
        description="Fundacao local para cupons confirmados pelo usuario. Nao ha coleta automatica nem inclusao automatica em copies."
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        Cadastre somente codigos conhecidos. Cupons vencidos, inativos ou sem
        compra minima atendida nao sao elegiveis; o sistema nao inventa codigos.
      </div>

      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          {success}
        </div>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-orange-600" />
          <h2 className="font-semibold text-slate-950">Novo cupom manual</h2>
        </div>
        <form
          onSubmit={submit}
          className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field
            label="Codigo"
            required
            value={draft.code}
            onChange={(value) =>
              setDraft((current) => ({ ...current, code: value }))
            }
          />
          <Field
            label="Descricao"
            required
            value={draft.description}
            onChange={(value) =>
              setDraft((current) => ({ ...current, description: value }))
            }
          />
          <label>
            <span className="text-sm font-medium text-slate-700">Tipo</span>
            <select
              value={draft.discountType}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  discountType: event.target
                    .value as ManualCouponInput['discountType'],
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="PERCENTAGE">Percentual</option>
              <option value="FIXED_AMOUNT">Valor fixo</option>
            </select>
          </label>
          <Field
            label="Desconto"
            required
            type="number"
            value={draft.discountValue}
            onChange={(value) =>
              setDraft((current) => ({ ...current, discountValue: value }))
            }
          />
          <Field
            label="Compra minima"
            type="number"
            value={draft.minPurchase ?? ''}
            onChange={(value) =>
              setDraft((current) => ({ ...current, minPurchase: value }))
            }
          />
          <Field
            label="Desconto maximo"
            type="number"
            value={draft.maxDiscount ?? ''}
            onChange={(value) =>
              setDraft((current) => ({ ...current, maxDiscount: value }))
            }
          />
          <Field
            label="Inicio"
            type="datetime-local"
            value={draft.startsAt ?? ''}
            onChange={(value) =>
              setDraft((current) => ({ ...current, startsAt: value }))
            }
          />
          <Field
            label="Fim"
            type="datetime-local"
            value={draft.endsAt ?? ''}
            onChange={(value) =>
              setDraft((current) => ({ ...current, endsAt: value }))
            }
          />
          <label className="sm:col-span-2 lg:col-span-4">
            <span className="text-sm font-medium text-slate-700">Termos</span>
            <textarea
              value={draft.terms}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  terms: event.target.value,
                }))
              }
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              disabled={
                submitting ||
                !draft.code.trim() ||
                !draft.description.trim() ||
                !draft.discountValue
              }
              className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Salvando' : 'Confirmar cupom manual'}
            </button>
          </div>
        </form>
      </section>

      {loading ? <LoadingState label="Carregando cupons" /> : null}
      {!loading && coupons.length === 0 ? (
        <EmptyState
          title="Nenhum cupom cadastrado"
          description="Cupons so aparecem depois de uma confirmacao manual."
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {coupons.map((coupon) => {
          const expired = isExpired(coupon);
          return (
            <article
              key={coupon.id}
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="rounded-md bg-orange-50 p-2 text-orange-700">
                    <TicketPercent className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-semibold text-slate-950">
                      {coupon.code}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {coupon.description}
                    </p>
                  </div>
                </div>
                <StatusBadge
                  tone={coupon.active && !expired ? 'ok' : 'warning'}
                >
                  {expired ? 'Vencido' : coupon.active ? 'Ativo' : 'Inativo'}
                </StatusBadge>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Metric
                  label="Desconto"
                  value={
                    coupon.discountType === 'PERCENTAGE'
                      ? `${coupon.discountValue}%`
                      : formatCurrency(Number(coupon.discountValue))
                  }
                />
                <Metric
                  label="Compra minima"
                  value={
                    coupon.minPurchase
                      ? formatCurrency(Number(coupon.minPurchase))
                      : 'Nao informada'
                  }
                />
                <Metric
                  label="Inicio"
                  value={formatDateTime(coupon.startsAt ?? undefined)}
                />
                <Metric
                  label="Fim"
                  value={formatDateTime(coupon.endsAt ?? undefined)}
                />
              </dl>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => void toggleCoupon(coupon)}
                  disabled={actionId === coupon.id || expired}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
                >
                  {coupon.active ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  type="button"
                  onClick={() => void removeCoupon(coupon)}
                  disabled={actionId === coupon.id}
                  className="rounded-md border border-rose-200 p-2 text-rose-700 disabled:opacity-40"
                  aria-label={`Excluir ${coupon.code}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        required={required}
        min={type === 'number' ? '0' : undefined}
        step={type === 'number' ? '0.01' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
    </label>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
