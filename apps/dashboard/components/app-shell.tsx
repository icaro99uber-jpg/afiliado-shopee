'use client';

import {
  ClipboardList,
  Copy,
  Home,
  Menu,
  PackageSearch,
  PlayCircle,
  Settings,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ApiStatus } from './api-status';
import { StatusBadge } from './status-badge';

const navigation = [
  { href: '/', label: 'Visao geral', icon: Home },
  { href: '/produtos', label: 'Produtos', icon: PackageSearch },
  { href: '/pipeline', label: 'Pipeline', icon: PlayCircle },
  { href: '/copies', label: 'Copies', icon: Copy },
  { href: '/whatsapp', label: 'WhatsApp', icon: ClipboardList },
  { href: '/configuracoes', label: 'Configuracoes', icon: Settings },
];

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="grid gap-1" aria-label="Navegacao principal">
      {navigation.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 ${
              active
                ? 'bg-orange-50 text-orange-700'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-200 bg-white px-4 py-5 lg:block">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">
            Shopee Affiliate
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">
            Operacao MVP
          </h2>
        </div>
        <NavigationLinks />
        <div className="absolute bottom-5 left-4 right-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-600">WhatsApp</p>
          <div className="mt-2">
            <StatusBadge tone="neutral">mock por padrao</StatusBadge>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-md border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 lg:hidden"
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <ApiStatus />
            <StatusBadge tone="neutral">Provider seguro no worker</StatusBadge>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>

      {open ? (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/40"
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-80 max-w-[85vw] bg-white p-4 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">
                  Shopee Affiliate
                </p>
                <h2 className="text-lg font-semibold text-slate-950">
                  Operacao MVP
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <NavigationLinks onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

