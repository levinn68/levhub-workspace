'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      router.replace('/chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tidak bisa masuk. Coba lagi.');
      setBusy(false);
    }
  }
  return <main className="workspace-gate">
    <section className="w-full max-w-sm space-y-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 sm:p-8">
      <header><p className="text-xs font-bold tracking-widest text-[var(--accent)]">LEVHUB</p><h1 className="mt-2 text-2xl font-semibold">Masuk ke workspace</h1><p className="mt-2 text-sm text-[var(--muted)]">Akses khusus pemilik.</p></header>
      <form onSubmit={submit} className="space-y-4">
        <div><label htmlFor="owner-password" className="text-sm font-medium">Kata sandi</label><input id="owner-password" required autoComplete="current-password" type={visible ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-[var(--line)] bg-transparent p-3" /><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} /> Tampilkan kata sandi</label></div>
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <button disabled={busy || !password.trim()} className="w-full rounded-lg border border-[var(--accent)] p-3 font-semibold no-underline disabled:opacity-50">{busy ? 'Memeriksa…' : 'Masuk'}</button>
      </form>
    </section>
  </main>;
}
