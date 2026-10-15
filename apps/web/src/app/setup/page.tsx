import type { Metadata } from 'next';
import { SignupScreen } from '@/components/auth/SignupScreen';

export const metadata: Metadata = { title: 'Set up Switchboard' };

/** First run of a self-hosted install: your organization, your account and your own home. */
export default function SetupPage() {
  return <SignupScreen mode="setup" />;
}
