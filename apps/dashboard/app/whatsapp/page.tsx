'use client';

import {
  Eye,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  ShieldOff,
  Users,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import {
  createDestination,
  getDispatch,
  listDestinations,
  listDispatches,
  listWhatsAppGroups,
  syncWhatsAppGroups,
  updateDestination,
  updateWhatsAppGroupAuthorization,
  type DispatchFilters,
  type WhatsAppDestination,
  type WhatsAppDispatch,
  type WhatsAppDispatchStatus,
  type WhatsAppGroup,
} from '../../lib/api';
import { formatDateTime, maskDestination } from '../../lib/format';

type DestinationDraft = {
  name: string;
  destination: string;
  active: boolean;
};

const emptyDestination: DestinationDraft = {
  name: '',
  destination: '',
  active: true,
};

export default function WhatsAppPage() {
  const [destinations, setDestinations] = useState<WhatsAppDestination[]>([]);
  const [dispatches, setDispatches] = useState<WhatsAppDispatch[]>([]);
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [dispatchFilters, setDispatchFilters] = useState<DispatchFilters>({
    status: '',
    destinationId: '',
    productId: '',
  });
  const [destinationDraft, setDestinationDraft] =
    useState<DestinationDraft>(emptyDestination);
  const [editing, setEditing] = useState<Record<string, DestinationDraft>>({});
  const [selectedDispatch, setSelectedDispatch] =
    useState<WhatsAppDispatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingDestination, setSubmittingDestination] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsSyncing, setGroupsSyncing] = useState(false);
  const [groupActionId, setGroupActionId] = useState<string | null>(null);
  const [confirmingGroupId, setConfirmingGroupId] = useState<string | null>(
    null,
  );
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [groupsSuccess, setGroupsSuccess] = useState<string | null>(null);

  const loadGroups = async () => {
    setGroupsLoading(true);
    setGroupsError(null);
    try {
      setGroups(await listWhatsAppGroups());
    } catch (err) {
      setGroupsError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setGroupsLoading(false);
    }
  };

  const loadDestinations = async () => {
    const response = await listDestinations();
    setDestinations(response);
    setEditing(
      Object.fromEntries(
        response.map((destination) => [
          destination.id,
          {
            name: destination.name,
            destination: destination.destination,
            active: destination.active,
          },
        ]),
      ),
    );
  };

  const loadDispatches = async () => {
    setDispatches(await listDispatches(dispatchFilters));
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadDestinations(), loadDispatches()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void loadGroups();
  }, []);

  const syncGroups = async () => {
    if (groupsSyncing) return;
    setGroupsSyncing(true);
    setGroupsError(null);
    setGroupsSuccess(null);
    try {
      const report = await syncWhatsAppGroups();
      await loadGroups();
      setGroupsSuccess(
        `Sincronização concluída: ${report.discovered} disponível(is), ${report.created} novo(s) e ${report.unavailable} indisponível(is).`,
      );
    } catch (err) {
      setGroupsError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setGroupsSyncing(false);
    }
  };

  const setGroupAuthorization = async (
    group: WhatsAppGroup,
    active: boolean,
  ) => {
    if (groupActionId || (active && !group.available)) return;
    setGroupActionId(group.id);
    setGroupsError(null);
    setGroupsSuccess(null);
    try {
      await updateWhatsAppGroupAuthorization(group.id, active);
      setConfirmingGroupId(null);
      await loadGroups();
      setGroupsSuccess(
        active
          ? 'Grupo autorizado no diretório. O master switch do worker continua obrigatório para qualquer envio futuro.'
          : 'Autorização do grupo removida.',
      );
    } catch (err) {
      setGroupsError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setGroupActionId(null);
    }
  };

  const filteredDispatches = useMemo(() => dispatches, [dispatches]);

  const createNewDestination = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      submittingDestination ||
      !destinationDraft.name.trim() ||
      !destinationDraft.destination.trim()
    ) {
      return;
    }
    setSubmittingDestination(true);
    setError(null);
    setSuccess(null);
    try {
      await createDestination({
        name: destinationDraft.name.trim(),
        destination: destinationDraft.destination.trim(),
        active: destinationDraft.active,
      });
      setDestinationDraft(emptyDestination);
      await loadDestinations();
      setSuccess('Destino criado com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setSubmittingDestination(false);
    }
  };

  const saveDestination = async (id: string) => {
    const draft = editing[id];
    if (!draft || savingId) return;
    setSavingId(id);
    setError(null);
    setSuccess(null);
    try {
      await updateDestination(id, {
        name: draft.name.trim(),
        destination: draft.destination.trim(),
        active: draft.active,
      });
      await loadDestinations();
      setSuccess('Destino atualizado com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setSavingId(null);
    }
  };

  const openDispatch = async (id: string) => {
    setLoadingDetailId(id);
    setError(null);
    try {
      setSelectedDispatch(await getDispatch(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoadingDetailId(null);
    }
  };

  const submitFilters = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loadDispatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="WhatsApp"
        description="Gerencie destinos e acompanhe dispatches existentes. Nao ha envio manual nesta tela."
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        O provider mock e o padrao. Evolution API so envia mensagens quando
        configurada explicitamente no ambiente do worker.
      </div>

      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          {success}
        </div>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-orange-600" aria-hidden="true" />
              <h2 className="font-semibold text-slate-950">Grupos</h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Descubra os grupos da conta conectada e autorize cada destino
              conscientemente. Sincronizar apenas consulta a Evolution API; não
              envia mensagens nem altera participantes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void syncGroups()}
            disabled={groupsSyncing || groupActionId !== null}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${groupsSyncing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {groupsSyncing ? 'Sincronizando...' : 'Sincronizar grupos'}
          </button>
        </div>

        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          Autorizar no diretório não habilita envios por si só. O master switch
          permanece desativado por padrão e não pode ser alterado no dashboard.
        </div>

        {groupsError ? (
          <div className="mt-4">
            <ErrorState
              title="Não foi possível carregar os grupos"
              message={groupsError}
              onRetry={loadGroups}
            />
          </div>
        ) : null}
        {groupsSuccess ? (
          <div
            role="status"
            className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800"
          >
            {groupsSuccess}
          </div>
        ) : null}
        {groupsLoading ? (
          <div className="mt-4">
            <LoadingState label="Carregando grupos" />
          </div>
        ) : null}
        {!groupsLoading && !groupsError && groups.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nenhum grupo disponível"
              description="Esta conta ainda não participa de nenhum grupo disponível."
            />
          </div>
        ) : null}

        {!groupsLoading && groups.length > 0 ? (
          <>
            <div className="mt-4 hidden overflow-hidden rounded-lg border border-slate-200 md:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Grupo</th>
                    <th className="px-4 py-3">Membros</th>
                    <th className="px-4 py-3">Disponibilidade</th>
                    <th className="px-4 py-3">Autorização</th>
                    <th className="px-4 py-3">Última sincronização</th>
                    <th className="px-4 py-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {groups.map((group) => (
                    <tr key={group.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-950">
                          {group.name}
                        </p>
                        <p className="mt-1 font-mono text-xs text-slate-500">
                          {group.fingerprint}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {group.memberCount ?? 'Não informado'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={group.available ? 'ok' : 'error'}>
                          {group.available ? 'Disponível' : 'Indisponível'}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={group.active ? 'ok' : 'neutral'}>
                          {group.active ? 'Autorizado' : 'Não autorizado'}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatDateTime(group.lastSyncedAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {group.active ? (
                          <button
                            type="button"
                            onClick={() =>
                              void setGroupAuthorization(group, false)
                            }
                            disabled={groupActionId !== null}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <ShieldOff className="h-4 w-4" aria-hidden="true" />
                            {groupActionId === group.id
                              ? 'Salvando...'
                              : 'Desautorizar'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingGroupId(group.id)}
                            disabled={
                              !group.available || groupActionId !== null
                            }
                            className="inline-flex items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-800 hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <ShieldCheck
                              className="h-4 w-4"
                              aria-hidden="true"
                            />
                            Autorizar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid gap-3 md:hidden">
              {groups.map((group) => (
                <article
                  key={group.id}
                  className="rounded-lg border border-slate-200 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-slate-950">
                        {group.name}
                      </h3>
                      <p className="mt-1 font-mono text-xs text-slate-500">
                        {group.fingerprint}
                      </p>
                    </div>
                    <StatusBadge tone={group.available ? 'ok' : 'error'}>
                      {group.available ? 'Disponível' : 'Indisponível'}
                    </StatusBadge>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-slate-500">Membros</dt>
                      <dd className="mt-1 font-medium text-slate-950">
                        {group.memberCount ?? 'Não informado'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Autorização</dt>
                      <dd className="mt-1 font-medium text-slate-950">
                        {group.active ? 'Autorizado' : 'Não autorizado'}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-slate-500">Última sincronização</dt>
                      <dd className="mt-1 font-medium text-slate-950">
                        {formatDateTime(group.lastSyncedAt)}
                      </dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    onClick={() =>
                      group.active
                        ? void setGroupAuthorization(group, false)
                        : setConfirmingGroupId(group.id)
                    }
                    disabled={
                      groupActionId !== null ||
                      (!group.active && !group.available)
                    }
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {group.active ? (
                      <ShieldOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    )}
                    {groupActionId === group.id
                      ? 'Salvando...'
                      : group.active
                        ? 'Desautorizar'
                        : 'Autorizar'}
                  </button>
                </article>
              ))}
            </div>
          </>
        ) : null}

        {confirmingGroupId ? (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="authorize-group-title"
            className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"
          >
            <section className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
              <h3
                id="authorize-group-title"
                className="font-semibold text-slate-950"
              >
                Autorizar este grupo?
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Esta ação registra uma autorização explícita no diretório. Ela
                não envia mensagem e não altera o master switch do worker.
              </p>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmingGroupId(null)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const group = groups.find(
                      (item) => item.id === confirmingGroupId,
                    );
                    if (group) void setGroupAuthorization(group, true);
                  }}
                  disabled={groupActionId !== null}
                  className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {groupActionId ? 'Autorizando...' : 'Confirmar autorização'}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-950">
          Novo destino individual
        </h2>
        <form
          onSubmit={createNewDestination}
          className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end"
        >
          <label>
            <span className="text-sm font-medium text-slate-700">Nome</span>
            <input
              value={destinationDraft.name}
              onChange={(event) =>
                setDestinationDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="Grupo de ofertas"
            />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">
              Identificador
            </span>
            <input
              value={destinationDraft.destination}
              onChange={(event) =>
                setDestinationDraft((current) => ({
                  ...current,
                  destination: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="mock-group-01"
            />
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2">
            <input
              type="checkbox"
              checked={destinationDraft.active}
              onChange={(event) =>
                setDestinationDraft((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
              className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
            />
            <span className="text-sm font-medium text-slate-700">Ativo</span>
          </label>
          <button
            type="submit"
            disabled={
              submittingDestination ||
              !destinationDraft.name.trim() ||
              !destinationDraft.destination.trim()
            }
            className="inline-flex items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {submittingDestination ? 'Criando...' : 'Criar'}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-950">Destinos</h2>
        {loading ? (
          <div className="mt-4">
            <LoadingState label="Carregando destinos" />
          </div>
        ) : null}
        {!loading && destinations.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nenhum destino cadastrado"
              description="Cadastre um destino ativo para que o pipeline possa criar dispatches."
            />
          </div>
        ) : null}
        <div className="mt-4 grid gap-3">
          {destinations.map((destination) => {
            const draft = editing[destination.id] ?? {
              name: destination.name,
              destination: destination.destination,
              active: destination.active,
            };
            return (
              <article
                key={destination.id}
                className="grid gap-3 rounded-md border border-slate-200 p-4 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end"
              >
                <label>
                  <span className="text-sm font-medium text-slate-700">
                    Nome
                  </span>
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setEditing((current) => ({
                        ...current,
                        [destination.id]: {
                          ...draft,
                          name: event.target.value,
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </label>
                <label>
                  <span className="text-sm font-medium text-slate-700">
                    Identificador
                  </span>
                  <input
                    value={draft.destination}
                    onChange={(event) =>
                      setEditing((current) => ({
                        ...current,
                        [destination.id]: {
                          ...draft,
                          destination: event.target.value,
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    Visualizacao: {maskDestination(draft.destination)}
                  </span>
                </label>
                <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(event) =>
                      setEditing((current) => ({
                        ...current,
                        [destination.id]: {
                          ...draft,
                          active: event.target.checked,
                        },
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                  />
                  <span className="text-sm font-medium text-slate-700">
                    {draft.active ? 'Ativo' : 'Inativo'}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => void saveDestination(destination.id)}
                  disabled={
                    savingId !== null ||
                    !draft.name.trim() ||
                    !draft.destination.trim()
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {savingId === destination.id ? 'Salvando...' : 'Salvar'}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold text-slate-950">Dispatches</h2>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Atualizar
          </button>
        </div>

        <form
          onSubmit={submitFilters}
          className="mt-4 grid gap-3 md:grid-cols-4"
        >
          <label>
            <span className="text-sm font-medium text-slate-700">Status</span>
            <select
              value={dispatchFilters.status}
              onChange={(event) =>
                setDispatchFilters((current) => ({
                  ...current,
                  status: event.target.value as WhatsAppDispatchStatus | '',
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">Todos</option>
              <option value="PENDING">PENDING</option>
              <option value="SENT">SENT</option>
              <option value="FAILED">FAILED</option>
            </select>
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">
              Destination ID
            </span>
            <input
              value={dispatchFilters.destinationId}
              onChange={(event) =>
                setDispatchFilters((current) => ({
                  ...current,
                  destinationId: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">
              Product ID
            </span>
            <input
              value={dispatchFilters.productId}
              onChange={(event) =>
                setDispatchFilters((current) => ({
                  ...current,
                  productId: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60 md:self-end"
          >
            Filtrar
          </button>
        </form>

        {loading ? (
          <div className="mt-4">
            <LoadingState label="Carregando dispatches" />
          </div>
        ) : null}
        {!loading && filteredDispatches.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nenhum dispatch encontrado"
              description="Ajuste os filtros ou execute o pipeline com destinos ativos."
            />
          </div>
        ) : null}

        {filteredDispatches.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3">Destino</th>
                  <th className="px-4 py-3">Tentativas</th>
                  <th className="px-4 py-3">Enviado em</th>
                  <th className="px-4 py-3">Erro</th>
                  <th className="px-4 py-3">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredDispatches.map((dispatch) => (
                  <tr key={dispatch.id}>
                    <td className="px-4 py-3">
                      <StatusBadge status={dispatch.status}>
                        {dispatch.status}
                      </StatusBadge>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-slate-700">
                      {dispatch.product?.nome ?? dispatch.productId}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {maskDestination(dispatch.destination?.destination)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {dispatch.attemptCount}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDateTime(dispatch.sentAt)}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-700">
                      {dispatch.errorMessage ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void openDispatch(dispatch.id)}
                        disabled={loadingDetailId === dispatch.id}
                        className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        {loadingDetailId === dispatch.id ? 'Abrindo...' : 'Ver'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {selectedDispatch ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="dispatch-title"
            className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="dispatch-title"
                  className="font-semibold text-slate-950"
                >
                  Detalhes do dispatch
                </h2>
                <p className="mt-1 break-all text-sm text-slate-500">
                  {selectedDispatch.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDispatch(null)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                Fechar
              </button>
            </div>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd className="mt-1">
                  <StatusBadge status={selectedDispatch.status}>
                    {selectedDispatch.status}
                  </StatusBadge>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">External message ID</dt>
                <dd className="mt-1 break-all font-medium text-slate-950">
                  {selectedDispatch.externalMessageId ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Produto</dt>
                <dd className="mt-1 font-medium text-slate-950">
                  {selectedDispatch.product?.nome ?? selectedDispatch.productId}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Destino</dt>
                <dd className="mt-1 font-medium text-slate-950">
                  {maskDestination(selectedDispatch.destination?.destination)}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Copy</dt>
                <dd className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-3 leading-6 text-slate-950">
                  {selectedDispatch.generatedCopy
                    ? `${selectedDispatch.generatedCopy.titulo}\n\n${selectedDispatch.generatedCopy.mensagem}\n\n${selectedDispatch.generatedCopy.cta}\n\n${selectedDispatch.generatedCopy.hashtags}`
                    : '—'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Erro seguro</dt>
                <dd className="mt-1 text-slate-950">
                  {selectedDispatch.errorMessage ?? '—'}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      ) : null}
    </div>
  );
}
