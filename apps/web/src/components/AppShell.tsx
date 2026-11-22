'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  MessageSquarePlus,
  Cpu,
  Plug,
  Sparkles,
  History,
  Settings,
  LogOut,
  Menu,
  X,
  Activity,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface HealthSummary {
  status: string;
  dependencies?: {
    router?: { ok: boolean };
    runtime?: { ok: boolean };
    supabase?: { ok: boolean };
  };
}

const NAV_ITEMS = [
  { href: '/chat', label: 'Chat Baru', icon: MessageSquarePlus },
  { href: '/history', label: 'Riwayat Chat', icon: History },
  { href: '/models', label: 'Katalog Model', icon: Cpu },
  { href: '/mcp', label: 'MCP Hub', icon: Plug },
  { href: '/skills', label: 'Skills Hub', icon: Sparkles },
  { href: '/settings', label: 'Pengaturan', icon: Settings },
];

export function AppShell({
  title,
  topBarExtra,
  children,
}: {
  title: string;
  topBarExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [health, setHealth] = useState<HealthSummary | null>(null);

  useEffect(() => {
    let mounted = true;
    apiFetch<{ authenticated: boolean }>('/api/auth/me')
      .then((res) => {
        if (!mounted) return;
        if (!res.authenticated) {
          router.replace('/login');
        } else {
          setAuthChecked(true);
        }
      })
      .catch(() => {
        if (mounted) router.replace('/login');
      });

    apiFetch<HealthSummary>('/api/health')
      .then((h) => mounted && setHealth(h))
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [router]);

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
    }
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="glass-panel rounded-2xl px-6 py-4 text-sm text-slate-300">
          Memverifikasi sesi LEVHUB...
        </div>
      </div>
    );
  }

  const isHealthy = health?.status === 'healthy';

  return (
    <div className="flex min-h-screen bg-transparent text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="glass-panel hidden w-64 shrink-0 flex-col justify-between border-r border-white/10 p-4 lg:flex">
        <div>
          <div className="mb-6 flex items-center gap-3 px-2 pt-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400/90 to-indigo-500/90 font-bold text-slate-950 shadow-glow">
              L
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wider text-white">LEVHUB</p>
              <p className="text-[11px] text-slate-400">AI Command Center</p>
            </div>
          </div>

          <nav className="space-y-1" aria-label="Navigasi utama">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    active
                      ? 'bg-sky-400/15 text-sky-200 ring-1 ring-sky-400/30'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3 border-t border-white/10 pt-4">
          <Link
            href="/settings/connections"
            className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06]"
          >
            <span className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
              Status Sistem
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                isHealthy ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isHealthy ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {isHealthy ? 'Sehat' : 'Perlu Cek'}
            </span>
          </Link>

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-300 transition hover:bg-rose-500/15 hover:text-rose-200"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Keluar
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="glass-panel relative z-10 flex w-64 flex-col justify-between p-4">
            <div>
              <div className="mb-6 flex items-center justify-between px-1">
                <span className="text-sm font-semibold tracking-wider text-white">LEVHUB</span>
                <button
                  type="button"
                  aria-label="Tutup menu"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
                        active ? 'bg-sky-400/15 text-sky-200' : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/15"
            >
              <LogOut className="h-4 w-4" />
              Keluar
            </button>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-panel sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-white/10 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Buka menu navigasi"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="truncate text-sm font-semibold tracking-tight text-white md:text-base">{title}</h1>
          </div>
          <div className="flex items-center gap-2">{topBarExtra}</div>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
