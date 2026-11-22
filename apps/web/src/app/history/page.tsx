'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, Pencil, Trash2, Download, MessageSquare } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

interface ConversationItem {
  id: string;
  title: string;
  model_id: string | null;
  updated_at: string;
}

export default function HistoryPage() {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadHistory(q = '') {
    setLoading(true);
    try {
      const qs = q ? `?search=${encodeURIComponent(q)}` : '';
      const res = await apiFetch<{ items: ConversationItem[] }>(`/api/conversations${qs}`);
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function handleRename(item: ConversationItem) {
    const next = prompt('Judul baru percakapan:', item.title);
    if (!next || !next.trim() || next.trim() === item.title) return;
    await apiFetch(`/api/conversations/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: next.trim() }),
    });
    await loadHistory(search);
  }

  async function handleDelete(id: string) {
    if (!confirm('Hapus percakapan ini dari riwayat LEVHUB?')) return;
    await apiFetch(`/api/conversations/${id}`, { method: 'DELETE' });
    await loadHistory(search);
  }

  return (
    <AppShell title="Riwayat Percakapan">
      <div className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadHistory(search);
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari judul percakapan..."
              className="glass-input w-full rounded-xl py-2 pl-9 pr-3 text-sm text-white"
            />
          </div>
          <button
            type="submit"
            className="rounded-xl bg-sky-400 px-4 text-xs font-semibold text-slate-950 hover:brightness-110"
          >
            Cari
          </button>
        </form>

        {!loading && items.length === 0 ? (
          <div className="glass-panel rounded-2xl p-8 text-center text-xs text-slate-400">
            Belum ada riwayat percakapan tersimpan di Supabase.
          </div>
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => (
              <div
                key={item.id}
                className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
              >
                <Link href={`/chat?id=${item.id}`} className="group min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 shrink-0 text-sky-400" />
                    <p className="truncate text-sm font-semibold text-white group-hover:text-sky-300">
                      {item.title}
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Model: {item.model_id || '-'} · Diperbarui {new Date(item.updated_at).toLocaleString('id-ID')}
                  </p>
                </Link>

                <div className="flex items-center gap-1.5">
                  <a
                    href={`/api/conversations/${item.id}/export?format=markdown`}
                    className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] hover:bg-white/15"
                  >
                    <Download className="h-3.5 w-3.5" /> MD
                  </a>
                  <a
                    href={`/api/conversations/${item.id}/export?format=json`}
                    className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] hover:bg-white/15"
                  >
                    JSON
                  </a>
                  <button
                    type="button"
                    aria-label="Ubah judul"
                    onClick={() => handleRename(item)}
                    className="rounded-lg bg-white/10 p-1.5 text-slate-300 hover:bg-white/15"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Hapus percakapan"
                    onClick={() => handleDelete(item.id)}
                    className="rounded-lg bg-rose-500/15 p-1.5 text-rose-300 hover:bg-rose-500/25"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
