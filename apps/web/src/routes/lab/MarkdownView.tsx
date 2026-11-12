/**
 * Renders the benchmark markdown (headings, paragraphs, pipe tables) as HTML, so the page and
 * the "Copy results as markdown" text come from one source. Tables scroll inside their own box
 * so the page never scrolls sideways at 360 px.
 */

/** Text with a stable key assigned while parsing. */
interface Keyed {
  key: string;
  text: string;
}

type Block =
  | { kind: 'h'; key: string; text: string }
  | { kind: 'p'; key: string; parts: (Keyed & { bold: boolean })[] }
  | { kind: 'table'; key: string; head: Keyed[]; rows: { key: string; cells: Keyed[] }[] };

function cells(line: string, prefix: string): Keyed[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c, n) => ({ key: `${prefix}c${n}`, text: c.trim() }));
}

/** **bold** spans only. */
function parts(text: string, prefix: string) {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((p, n) =>
      p.startsWith('**')
        ? { key: `${prefix}s${n}`, text: p.slice(2, -2), bold: true }
        : { key: `${prefix}s${n}`, text: p, bold: false },
    );
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const key = `b${blocks.length}`;
    if (line.startsWith('### ')) blocks.push({ kind: 'h', key, text: line.slice(4) });
    else if (line.startsWith('|')) {
      const head = cells(line, `${key}h`);
      const rows: { key: string; cells: Keyed[] }[] = [];
      i += 2; // skip the separator row
      while (i < lines.length && (lines[i] as string).startsWith('|')) {
        const rk = `${key}r${rows.length}`;
        rows.push({ key: rk, cells: cells(lines[i] as string, rk) });
        i++;
      }
      i--;
      blocks.push({ kind: 'table', key, head, rows });
    } else if (line.trim()) blocks.push({ kind: 'p', key, parts: parts(line, key) });
  }
  return blocks;
}

export function MarkdownView({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {blocks.map((b) => {
        if (b.kind === 'h') {
          return (
            <h3 key={b.key} className="mt-2 text-base font-semibold">
              {b.text}
            </h3>
          );
        }
        if (b.kind === 'p') {
          return (
            <p key={b.key} className="text-sm break-words opacity-90">
              {b.parts.map((p) =>
                p.bold ? <strong key={p.key}>{p.text}</strong> : <span key={p.key}>{p.text}</span>,
              )}
            </p>
          );
        }
        return (
          <div key={b.key} className="max-w-full overflow-x-auto rounded border border-white/10">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr>
                  {b.head.map((h) => (
                    <th
                      key={h.key}
                      className="border-b border-white/10 px-2 py-1 text-left font-semibold whitespace-nowrap"
                    >
                      {h.text}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r) => (
                  <tr key={r.key} className="odd:bg-white/5">
                    {r.cells.map((c) => (
                      <td key={c.key} className="px-2 py-1 align-top whitespace-nowrap">
                        {c.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
