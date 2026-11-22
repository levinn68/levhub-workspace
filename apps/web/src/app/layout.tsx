import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LEVHUB — Personal AI Command Center',
  description: 'Workspace AI pribadi dengan Model Router, MCP Hub, Skills Hub, dan riwayat percakapan Supabase.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="dark">
      <body className="antialiased selection:bg-sky-500/30 selection:text-sky-100">
        {children}
      </body>
    </html>
  );
}
