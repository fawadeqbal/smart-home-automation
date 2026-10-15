'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthForm, Field } from '@/components/AuthForm';
import { get, post } from '@/lib/api';
import { landingFor } from '@/lib/session';
import type { Me } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const [signupOpen, setSignupOpen] = useState(false);

  useEffect(() => {
    get<{ setupNeeded: boolean; signupOpen: boolean }>('/auth/status')
      .then((s) => { if (s.setupNeeded) router.replace('/setup'); setSignupOpen(s.signupOpen); })
      .catch(() => undefined);
  }, [router]);

  return (
    <AuthForm
      title="Sign in"
      intro="Welcome back."
      submitLabel="Sign in"
      footer={signupOpen && <>New installer company? <Link href="/signup">Create an organization</Link></>}
      onSubmit={async (f) => {
        const me = await post<Me>('/auth/login', { email: f.get('email'), password: f.get('password') });
        const next = new URLSearchParams(window.location.search).get('next');
        router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : landingFor(me));
      }}
    >
      <Field label="Email" name="email" type="email" autoComplete="email" required autoFocus />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
    </AuthForm>
  );
}
