'use client';

type Part = { kind: 'text'; text: string } | { kind: 'code'; text: string } | { kind: 'quote'; text: string } | { kind: 'heading'; text: string } | { kind: 'list'; items: string[] };

function parse(source: string): Part[] {
  const parts: Part[] = [];
  for (const block of source.split(/(```[\s\S]*?```)/g)) {
    if (!block) continue;
    if (block.startsWith('```') && block.endsWith('```')) {
      parts.push({ kind: 'code', text: block.slice(3, -3).replace(/^[\w-]*\n/, '') });
      continue;
    }
    let list: string[] = [];
    const flushList = () => { if (list.length) { parts.push({ kind: 'list', items: list }); list = []; } };
    for (const line of block.split('\n')) {
      if (!line.trim()) { flushList(); continue; }
      if (/^\s*[-*+]\s+/.test(line)) { list.push(line.replace(/^\s*[-*+]\s+/, '')); continue; }
      flushList();
      if (line.startsWith('> ')) parts.push({ kind: 'quote', text: line.slice(2) });
      else if (/^#{1,6}\s/.test(line)) parts.push({ kind: 'heading', text: line.replace(/^#{1,6}\s+/, '') });
      else parts.push({ kind: 'text', text: line });
    }
    flushList();
  }
  return parts;
}

const inline = (text: string) => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((chunk, index) => {
  if (chunk.startsWith('**') && chunk.endsWith('**')) return <strong key={index}>{chunk.slice(2, -2)}</strong>;
  if (chunk.startsWith('`') && chunk.endsWith('`')) return <code key={index} className="chat-inline-code">{chunk.slice(1, -1)}</code>;
  return <span key={index}>{chunk}</span>;
});

/** Renders model text as React nodes without HTML injection. */
export function SafeMarkdown({ content }: { content: string }) {
  return <div className="chat-markdown">{parse(content).map((part, index) => {
    if (part.kind === 'code') return <pre key={index}><code>{part.text}</code></pre>;
    if (part.kind === 'quote') return <blockquote key={index}>{inline(part.text)}</blockquote>;
    if (part.kind === 'heading') return <h3 key={index}>{inline(part.text)}</h3>;
    if (part.kind === 'list') return <ul key={index}>{part.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>;
    return <p key={index}>{inline(part.text)}</p>;
  })}</div>;
}
