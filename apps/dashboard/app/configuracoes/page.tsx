'use client';

import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { getApiBaseUrl, getHealth } from '../../lib/api';

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setLoading(true);
    setError(null);
    try {
      const health = await getHealth();
      setOnline(health.status === 'ok');
    } catch (err) {
      setOnline(false);
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void check();
  }, []);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Configuracoes"
        description="Informacoes seguras de operacao do dashboard. Credenciais nunca devem ser inseridas no navegador."
      />

      {loading ? <LoadingState label="Verificando API" /> : null}
      {error ? <ErrorState message={error} onRetry={check} /> : null}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-950">API usada</h2>
            <p className="mt-1 break-all text-sm text-slate-600">
              {getApiBaseUrl()}
            </p>
          </div>
          <StatusBadge tone={online ? 'ok' : 'error'}>
            {online ? 'online' : 'offline'}
          </StatusBadge>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex gap-3">
          <ShieldCheck
            className="mt-1 h-5 w-5 shrink-0 text-emerald-600"
            aria-hidden="true"
          />
          <div>
            <h2 className="font-semibold text-slate-950">
              Credenciais e provider WhatsApp
            </h2>
            <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-700">
              <p>
                O frontend conhece apenas configuracoes publicas, como
                NEXT_PUBLIC_API_URL. Chaves da Evolution API ficam no .env local
                do worker.
              </p>
              <p>
                WHATSAPP_PROVIDER=mock e o modo seguro padrao e nao envia
                mensagens reais. WHATSAPP_PROVIDER=evolution exige configuracao
                explicita no ambiente do worker.
              </p>
              <p>
                O dashboard nao salva segredos em localStorage e nao possui campo
                para EVOLUTION_API_KEY.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-950">Limitacoes atuais</h2>
        <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-700">
          <li>Nao ha endpoint publico de listagem completa de produtos.</li>
          <li>Nao ha endpoint agregado para indicadores de score e aprovacao.</li>
          <li>Nao ha endpoint de historico/listagem de copies geradas.</li>
          <li>Nao ha endpoint de reprocessamento manual de dispatches.</li>
        </ul>
      </section>
    </div>
  );
}

