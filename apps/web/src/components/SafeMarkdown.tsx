'use client';

import React from 'react';

/**
 * XSS-safe lightweight Markdown renderer (S-010).
 * Never uses dangerouslySetInnerHTML; renders code blocks, inline code, and paragraphs safely.
 */
export function SafeMarkdown({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-slate-100">
      {parts.map((part, idx) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.slice(3, -3).replace(/^[a-zA-Z0-9_-]+\n/, '');
          return (
            <pre
              key={idx}
              className="overflow-x-auto rounded-xl border border-white/10 bg-black/55 p-3.5 font-mono text-xs text-sky-100"
            >
              <code>{inner}</code>
            </pre>
          );
        }

        const lines = part.split('\n').filter((l) => l.length > 0);
        return (
          <div key={idx} className="space-y-1.5">
            {lines.map((line, lineIdx) => (
              <p key={lineIdx} className="whitespace-pre-wrap break-words">
                {line}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
