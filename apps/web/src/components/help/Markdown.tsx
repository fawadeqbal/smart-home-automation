'use client';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CHECKS } from '@/lib/help';

/**
 * A Help Center article, formatted: headings, steps, bold, tables, links. Raw HTML in the text is not
 * rendered (shown as text), so an article can never run anything in the reader's browser.
 * `[[check: …]]` notes in drafts are highlighted for the editor to replace.
 */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const source = text.replace(CHECKS, (_, note: string) => `[${note.trim().replace(/[[\]]/g, '') || 'check'}](#check)`);
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href === '#check') return <mark className="md-check" title="To confirm before publishing">{children}</mark>;
            if (href?.startsWith('/')) return <Link href={href}>{children}</Link>;
            return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
          },
          table: ({ children }) => <div className="md-table"><table>{children}</table></div>,
          img: ({ alt }) => <span className="muted">{alt}</span>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
