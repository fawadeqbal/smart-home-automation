import type { Metadata } from 'next';
import { SignupScreen } from '@/components/auth/SignupScreen';

export const metadata: Metadata = { title: 'Create your organization · Switchboard' };

/** A new organization (installer company): 14-day trial, you are its super admin. */
export default function SignupPage() {
  return <SignupScreen mode="signup" />;
}
