'use client';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CHECKS } from '@/lib/help';
import { Icon } from '../Icon';

/**
 * A Help Center article, formatted: headings, steps, bold, tables, links. Raw HTML in the text is not
 * rendered (shown as text), so an article can never run anything in the reader's browser.
 * `[[check: …]]` notes in drafts are highlighted for the editor to replace.
 */
export function Markdown({ text, className = '', onNavigate }: {
  text: string;
  className?: string;
  /** called when an in-app link is followed (the assistant on a phone steps aside) */
  onNavigate?: () => void;
}) {
  const source = text.replace(CHECKS, (_, note: string) => `[${note.trim().replace(/[[\]]/g, '') || 'check'}](#check)`);
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href === '#check') return <mark className="md-check" title="To confirm before publishing">{children}</mark>;
            if (href?.startsWith('/')) {
              const article = /^\/(console\/)?help(\/[a-z0-9]{20,}|\?a=)/i.test(href);   // an article's own page
              return (
                <Link href={href} onClick={onNavigate} className={article ? 'md-article' : undefined}>
                  {article && <Icon name="file-text" size={12} />}{children}
                </Link>
              );
            }
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
