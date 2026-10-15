'use client';
import { useRouter } from 'next/navigation';
import { AuthForm, Field } from '@/components/AuthForm';
import { post } from '@/lib/api';

/** First run of a self-hosted install: your organization, your account and your own home. */
export default function SetupPage() {
  const router = useRouter();
  return (
    <AuthForm
      title="Set up Switchboard"
      intro="First run on this server. You become the super admin and the owner of your home; you can add more homes, staff and boards later."
      submitLabel="Create"
      onSubmit={async (f) => {
        await post('/auth/setup', { homeName: f.get('homeName'), name: f.get('name'), email: f.get('email'), password: f.get('password') });
        router.replace('/console');
      }}
    >
      <Field label="Home (or company) name" name="homeName" defaultValue="Our home" required />
      <Field label="Your name" name="name" autoComplete="name" required />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Password (8+ characters)" name="password" type="password" minLength={8} autoComplete="new-password" required />
    </AuthForm>
  );
}
