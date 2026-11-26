type Part = { kind: 'list'; items: string[]; ordered: boolean } | { kind: 'code'; text: string } | { kind: 'quote'; text: string } | { kind: 'heading'; text: string } | { kind: 'text'; text: string };

function parse(source: string): Part[] {
  const parts: Part[] = [];
  for (const block of source.split(/(```[\s\S]*?```)/g)) {
    if (!block) continue;
    if (block.startsWith('```') && block.endsWith('```')) {
      parts.push({ kind: 'code', text: block.slice(3, -3).replace(/^[\w-]*\n/, '') });
      continue;
    }
    let items: string[] = [];
    let ordered = false;
    const flush = () => { if (items.length) { parts.push({ kind: 'list', items, ordered }); items = []; } };
    for (const line of block.split('\n')) {
      if (!line.trim()) { flush(); continue; }
      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || number) {
        const isOrdered = Boolean(number);
        if (items.length && ordered !== isOrdered) flush();
        ordered = isOrdered;
        items.push((bullet ?? number)![1]);
        continue;
      }
      flush();
      if (line.startsWith('> ')) parts.push({ kind: 'quote', text: line.slice(2) });
      else if (/^#{1,6}\s/.test(line)) parts.push({ kind: 'heading', text: line.replace(/^#{1,6}\s+/, '') });
      else parts.push({ kind: 'text', text: line });
    }
    flush();
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
    if (part.kind === 'list') return part.ordered
      ? <ol key={index}>{part.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ol>
      : <ul key={index}>{part.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>;
    return <p key={index}>{inline(part.text)}</p>;
  })}</div>;
}
