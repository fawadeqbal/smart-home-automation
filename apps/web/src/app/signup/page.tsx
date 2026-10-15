'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthForm, Field } from '@/components/AuthForm';
import { get, post } from '@/lib/api';

/** A new organization (installer company): 14-day trial, you are its super admin. */
export default function SignupPage() {
  const router = useRouter();
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    get<{ setupNeeded: boolean; signupOpen: boolean }>('/auth/status').then((s) => setClosed(!s.signupOpen)).catch(() => undefined);
  }, []);
  return (
    <AuthForm
      title="Create your organization"
      intro={closed ? 'Sign-up is closed on this server — ask your administrator for an invite.' : 'Free for 14 days. You’ll be its super admin and can invite installers and support.'}
      submitLabel="Create organization"
      footer={<>Already have an account? <Link href="/login">Sign in</Link></>}
      onSubmit={async (f) => {
        await post('/auth/signup', { orgName: f.get('orgName'), name: f.get('name'), email: f.get('email'), password: f.get('password') });
        router.replace('/console');
      }}
    >
      <Field label="Company name" name="orgName" placeholder="Bright Homes Automation" required autoFocus maxLength={80} />
      <Field label="Your name" name="name" autoComplete="name" required maxLength={80} />
      <Field label="Work email" name="email" type="email" autoComplete="email" required />
      <Field label="Password (8+ characters)" name="password" type="password" minLength={8} autoComplete="new-password" required />
    </AuthForm>
  );
}
