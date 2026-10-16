'use client';
import { useParams } from 'next/navigation';
import { ArticleEditor } from '@/components/help/ArticleEditor';
import { EditorsOnly } from '@/components/help/EditorsOnly';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { ErrorBox } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import type { HelpArticleFull } from '@/lib/types';

/** Editing one Help Center article (super admins), on its own page. */
export default function EditArticlePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useLoad<HelpArticleFull>(`/platform/help/${id}`);
  useCrumbs([
    { label: 'Platform', href: '/console' }, { label: 'Help Center', href: '/console/help' },
    { label: data?.title ?? 'Article', href: `/console/help/${id}` }, { label: 'Edit' },
  ]);
  return (
    <EditorsOnly back={`/console/help/${id}`}>
      {data ? <ArticleEditor key={data.id + data.updatedAt} article={data} /> : error ? <ErrorBox error={error} /> : <Loader label="Loading the article…" />}
    </EditorsOnly>
  );
}
