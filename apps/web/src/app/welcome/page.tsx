import type { Metadata } from 'next';
import { Landing } from '@/components/landing/Landing';

export const metadata: Metadata = {
  title: 'Switchboard — a smarter home, without the hassle',
  description: 'Lights, fans, AC, geyser and water motor — from your phone, by voice in Urdu or English, or on a schedule. We set it all up. Book a free home visit.',
  openGraph: {
    title: 'Switchboard — your home, now it listens',
    description: 'Control lights, fans, AC, geyser and water motor from your phone or by voice in Urdu or English. Free home visit in Lahore, Karachi and Islamabad.',
    type: 'website',
  },
};

/** The public landing page. Visitors who aren't signed in also see it at / (src/middleware.ts). */
export default function WelcomePage() {
  return <Landing />;
}
