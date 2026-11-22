'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  MessageSquarePlus, Cpu, Plug, Sparkles, History, Settings, LogOut,
  Menu, X, Activity, ChevronRight, Command,
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
  { href: '/chat', label: 'Chat Baru', caption: 'Ruang kerja AI', icon: MessageSquarePlus },
  { href: '/history', label: 'Riwayat Chat', caption: 'Percakapan tersimpan', icon: History },
  { href: '/models', label: 'Katalog Model', caption: 'Pilih model AI', icon: Cpu },
  { href: '/mcp', label: 'MCP Hub', caption: 'Tools & integrasi', icon: Plug },
  { href: '/skills', label: 'Skills Hub', caption: 'Kemampuan AI', icon: Sparkles },
  { href: '/settings', label: 'Pengaturan', caption: 'Workspace & keamanan', icon: Settings },
];
const MOBILE_NAV = NAV_ITEMS.filter(item => ['/chat', '/models', '/mcp', '/skills'].includes(item.href));

export function AppShell({ title, topBarExtra, children }: {
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
      .then(res => {
        if (!mounted) return;
        if (!res.authenticated) router.replace('/login');
        else setAuthChecked(true);
      })
      .catch(() => { if (mounted) router.replace('/login'); });
    apiFetch<HealthSummary>('/api/health').then(h => mounted && setHealth(h)).catch(() => {});
    return () => { mounted = false; };
  }, [router]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  async function handleLogout() {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); }
    finally { router.replace('/login'); }
  }

  if (!authChecked) return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-panel flex items-center gap-3 rounded-2xl px-5 py-4 text-sm text-slate-300">
        <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" /> Memverifikasi sesi LEVHUB...
      </div>
    </div>
  );

  const isHealthy = health?.status === 'healthy';
  const renderNav = (mobile = false) => NAV_ITEMS.map(item => {
    const Icon = item.icon;
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link key={item.href} href={item.href}
        className={`group flex items-center gap-3 rounded-2xl px-3 py-3 transition ${active
          ? 'border border-sky-300/15 bg-gradient-to-r from-sky-400/15 to-indigo-400/10 text-white shadow-lg shadow-sky-950/10'
          : 'border border-transparent text-slate-400 hover:bg-white/[.045] hover:text-slate-100'}`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-sky-300/15 text-sky-200' : 'bg-white/[.035] text-slate-400 group-hover:text-slate-200'}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold">{item.label}</span>
          <span className={`mt-0.5 block text-[10px] ${active ? 'text-sky-100/60' : 'text-slate-600'}`}>{item.caption}</span>
        </span>
        {active && <ChevronRight className="h-4 w-4 text-sky-200/70"/>}
      </Link>
    );
  });

  return (
    <div className="min-h-screen text-slate-100 lg:flex">
      <aside className="glass-panel fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col justify-between rounded-none border-y-0 border-l-0 p-4 lg:flex">
        <div>
          <Link href="/chat" className="mb-8 flex items-center gap-3 rounded-2xl px-2 py-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-300 via-blue-400 to-indigo-500 text-lg font-black text-slate-950 shadow-lg shadow-blue-950/40">L</span>
            <span><span className="block text-sm font-bold tracking-[.18em] text-white">LEVHUB</span><span className="mt-0.5 block text-[10px] text-slate-500">PERSONAL AI WORKSPACE</span></span>
          </Link>
          <div className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[.22em] text-slate-600">Workspace</div>
          <nav className="space-y-1.5" aria-label="Navigasi utama">{renderNav()}</nav>
        </div>
        <div className="space-y-3">
          <Link href="/settings/connections" className="block rounded-2xl border border-white/[.07] bg-white/[.025] p-3 transition hover:bg-white/[.05]">
            <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[11px] font-semibold text-slate-300"><Activity className="h-3.5 w-3.5 text-sky-300"/> Status sistem</span><span className={`h-2 w-2 rounded-full ${isHealthy ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.6)]' : 'bg-amber-400'}`}/></div>
            <p className="mt-2 text-[10px] text-slate-500">{isHealthy ? 'Semua layanan utama terpantau sehat' : 'Periksa kondisi koneksi layanan'}</p>
          </Link>
          <button type="button" onClick={handleLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium text-slate-500 transition hover:bg-rose-400/10 hover:text-rose-200"><LogOut className="h-4 w-4"/> Keluar dari workspace</button>
          <div className="flex items-center justify-between px-3 text-[9px] text-slate-700"><span>LEVHUB WORKSPACE</span><span>v1.0</span></div>
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 z-[70] lg:hidden">
        <button type="button" aria-label="Tutup menu" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-black/70 backdrop-blur-sm"/>
        <aside className="glass-panel relative flex h-full w-[min(86vw,320px)] flex-col justify-between rounded-none border-y-0 border-l-0 p-4 shadow-2xl">
          <div><div className="mb-7 flex items-center justify-between px-1"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-300 to-indigo-500 font-black text-slate-950">L</span><span className="text-sm font-bold tracking-[.16em]">LEVHUB</span></div><button type="button" aria-label="Tutup menu" onClick={() => setMobileOpen(false)} className="rounded-xl bg-white/[.06] p-2 text-slate-300"><X className="h-4 w-4"/></button></div><p className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[.22em] text-slate-600">Navigasi workspace</p><nav className="space-y-1.5">{renderNav(true)}</nav></div>
          <div className="space-y-2"><Link href="/settings/connections" className="flex items-center gap-2 rounded-xl bg-white/[.04] px-3 py-3 text-xs text-slate-300"><Activity className="h-4 w-4 text-sky-300"/> Status sistem</Link><button type="button" onClick={handleLogout} className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-xs text-rose-300 hover:bg-rose-400/10"><LogOut className="h-4 w-4"/> Keluar</button></div>
        </aside>
      </div>}

      <div className="min-w-0 flex-1 lg:ml-[264px]">
        <header className="sticky top-0 z-30 border-b border-white/[.07] bg-[#0b111d]/85 backdrop-blur-2xl">
          <div className="mx-auto flex h-[68px] w-full max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" aria-label="Buka menu navigasi" onClick={() => setMobileOpen(true)} className="rounded-xl border border-white/10 bg-white/[.04] p-2 text-slate-300 hover:bg-white/[.08] lg:hidden"><Menu className="h-4 w-4"/></button>
              <div className="min-w-0"><p className="truncate text-sm font-semibold tracking-tight text-white sm:text-base">{title}</p><p className="mt-0.5 hidden text-[10px] text-slate-500 sm:block">LEVHUB <span className="px-1 text-slate-700">/</span> Personal AI Workspace</p></div>
            </div>
            <div className="flex shrink-0 items-center gap-2">{topBarExtra}<div className="hidden h-8 w-8 items-center justify-center rounded-xl border border-white/[.08] bg-white/[.04] text-slate-400 sm:flex"><Command className="h-3.5 w-3.5"/></div></div>
          </div>
        </header>
        <main className="mx-auto flex min-h-[calc(100vh-68px)] w-full max-w-[1440px] flex-col px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">{children}</main>
      </div>

      <nav aria-label="Navigasi cepat" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[.08] bg-[#090e18]/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur-2xl lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
          {MOBILE_NAV.map(item => { const Icon=item.icon; const active=pathname===item.href||pathname.startsWith(`${item.href}/`); return <Link key={item.href} href={item.href} className={`flex flex-col items-center gap-1 rounded-xl px-1 py-1.5 ${active?'text-sky-200':'text-slate-500'}`}><span className={`flex h-7 w-9 items-center justify-center rounded-xl ${active?'bg-sky-300/15':''}`}><Icon className="h-[17px] w-[17px]"/></span><span className="text-[9px] font-medium">{item.href==='/chat'?'Chat':item.href==='/models'?'Models':item.href==='/mcp'?'MCP':'Skills'}</span></Link>; })}
          <button type="button" onClick={() => setMobileOpen(true)} className="flex flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-slate-500"><span className="flex h-7 w-9 items-center justify-center"><Menu className="h-[17px] w-[17px]"/></span><span className="text-[9px] font-medium">Menu</span></button>
        </div>
      </nav>
    </div>
  );
}
