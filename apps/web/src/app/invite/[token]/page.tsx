'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthForm, Field } from '@/components/AuthForm';
import { errorText, get, post } from '@/lib/api';
import { Loader } from '@/components/Loader';
import { ROLE_LABEL, STAFF_LABEL } from '@/lib/roles';
import { landingFor } from '@/lib/session';
import type { Me, Role, StaffRole } from '@/lib/types';

interface InviteInfo { email: string; name: string | null; role: Role | null; staffRole: StaffRole | null; homeName: string | null; orgName: string | null; existingAccount: boolean }

/** Joining a home (family, owner) or an organization's team (installer, support, super admin). */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<InviteInfo>(`/invites/${token}`).then(setInvite).catch((e) => setError(errorText(e)));
  }, [token]);

  if (error) {
    return (
      <main className="auth-solo">
        <div className="card card-pad auth-card"><h1>Invite</h1><div className="alert">{error}</div><a className="btn" href="/login">Sign in</a></div>
      </main>
    );
  }
  if (!invite) return <Loader full label="Opening your invite…" />;
  const place = invite.staffRole ? invite.orgName ?? 'the team' : invite.homeName ?? 'the home';
  const as = invite.staffRole ? STAFF_LABEL[invite.staffRole] : invite.role ? ROLE_LABEL[invite.role] : '';

  return (
    <AuthForm
      title={`Join ${place}`}
      intro={invite.existingAccount
        ? <>You’re invited as <b>{as.toLowerCase()}</b>. You already have an account ({invite.email}) — confirm with your password.</>
        : <>You’re invited as <b>{as.toLowerCase()}</b> with {invite.email}. Choose your name and a password.</>}
      submitLabel="Join"
      onSubmit={async (f) => {
        const me = await post<Me>(`/invites/${token}/accept`, { name: f.get('name') ?? undefined, password: f.get('password') });
        router.replace(invite.staffRole ? landingFor(me) : '/');
      }}
    >
      {!invite.existingAccount && <Field label="Your name" name="name" autoComplete="name" defaultValue={invite.name ?? ''} required autoFocus />}
      <Field label={invite.existingAccount ? 'Your password' : 'Password (8+ characters)'} name="password" type="password"
        minLength={invite.existingAccount ? 1 : 8} autoComplete={invite.existingAccount ? 'current-password' : 'new-password'} required autoFocus={invite.existingAccount} />
    </AuthForm>
  );
}
