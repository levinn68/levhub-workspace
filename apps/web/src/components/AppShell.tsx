'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, Cpu, History, LogOut, MessageSquarePlus, Plug, Settings, Sparkles } from 'lucide-react';
import { apiFetch } from '@/lib/api';

const destinations = [
  { href: '/chat', label: 'Chat', icon: MessageSquarePlus },
  { href: '/history', label: 'Riwayat', icon: History },
  { href: '/models', label: 'Model', icon: Cpu },
  { href: '/mcp', label: 'MCP', icon: Plug },
  { href: '/skills', label: 'Skills', icon: Sparkles },
  { href: '/settings', label: 'Pengaturan', icon: Settings },
  { href: '/settings/connections', label: 'Status koneksi', icon: Activity },
];

export function AppShell({ title, topBarExtra, children }: { title: string; topBarExtra?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<'checking' | 'ready' | 'error'>('checking');
  const [attempt, setAttempt] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch<{ authenticated: boolean }>('/api/auth/me', { signal: AbortSignal.timeout(10000) })
      .then(({ authenticated }) => {
        if (!active) return;
        if (authenticated) setSession('ready');
        else router.replace('/login');
      })
      .catch(() => { if (active) setSession('error'); });
    return () => { active = false; };
  }, [router, attempt]);

  async function logout() {
    setLoggingOut(true);
    setLogoutError(false);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      setSession('checking');
      router.replace('/login');
    } catch {
      setLogoutError(true);
      setLoggingOut(false);
    }
  }

  const current = [...destinations].reverse().find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))?.href;
  const navigation = destinations.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={current === href ? 'page' : undefined}>
    <Icon aria-hidden="true" size={17} /><span>{label}</span>
  </Link>);
  const signOut = session === 'ready' && <><button className="workspace-logout" type="button" disabled={loggingOut} onClick={() => void logout()}><LogOut aria-hidden="true" size={17} /> Keluar</button>{logoutError && <p role="alert" className="workspace-error">Gagal keluar. Coba lagi.</p>}</>;

  return <div className="workspace-frame" data-chat={pathname === '/chat' ? 'true' : undefined}>
    <a className="workspace-skip" href="#workspace-main">Lewati ke konten</a>
    <aside className="workspace-sidebar">
      <Link href="/chat" className="workspace-brand"><span aria-hidden="true">L</span> LEVHUB</Link>
      <nav aria-label="Navigasi workspace">{navigation}</nav>
      <div className="workspace-account">{signOut}</div>
    </aside>
    <div className="workspace-body">
      <header className="workspace-header">
        <details className="workspace-mobile-menu" key={pathname}>
          <summary aria-label="Menu workspace">Menu</summary>
          <div className="workspace-menu-panel"><nav aria-label="Navigasi mobile">{navigation}</nav>{signOut}</div>
        </details>
        <p className="workspace-title">{title}</p>
        {session === 'ready' && topBarExtra && <div className="workspace-controls">{topBarExtra}</div>}
      </header>
      <main id="workspace-main" className="workspace-main" aria-busy={session === 'checking'}>
        {session === 'ready' && children}
        {session === 'error' && <section className="glass-card space-y-3 rounded-xl p-4">
          <p role="alert">Workspace belum bisa dibuka. Cek koneksi lalu coba lagi.</p>
          <button type="button" className="rounded-lg border px-3 py-2" onClick={() => { setSession('checking'); setAttempt((n) => n + 1); }}>Coba lagi</button>
        </section>}
      </main>
    </div>
  </div>;
}
