import type { Metadata } from 'next';
import './globals.css';
import './workspace.css';

export const metadata: Metadata = {
  title: 'LEVHUB — Workspace AI Pribadi',
  description: 'Chat, model, dan tools AI dalam satu workspace pribadi.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="id" className="dark"><body className="antialiased">{children}</body></html>;
}
