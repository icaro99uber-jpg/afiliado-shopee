'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getApiBaseUrl, getHealth } from '../lib/api';
import { StatusBadge } from './status-badge';

type ApiState = 'checking' | 'online' | 'offline';

export function ApiStatus() {
  const [state, setState] = useState<ApiState>('checking');

  const check = async () => {
    setState('checking');
    try {
      await getHealth();
      setState('online');
    } catch {
      setState('offline');
    }
  };

  useEffect(() => {
    void check();
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <StatusBadge
        tone={
          state === 'online' ? 'ok' : state === 'offline' ? 'error' : 'neutral'
        }
      >
        API {state === 'online' ? 'online' : state === 'offline' ? 'offline' : 'checando'}
      </StatusBadge>
      <span className="max-w-[220px] truncate">{getApiBaseUrl()}</span>
      <button
        type="button"
        onClick={check}
        className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
        title="Verificar API"
        aria-label="Verificar API"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

