'use client';
import { ArticleEditor } from '@/components/help/ArticleEditor';
import { EditorsOnly } from '@/components/help/EditorsOnly';
import { useCrumbs } from '@/components/Shell';

/** A new Help Center article (super admins). */
export default function NewArticlePage() {
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Help Center', href: '/console/help' }, { label: 'New article' }]);
  return <EditorsOnly><ArticleEditor /></EditorsOnly>;
}
