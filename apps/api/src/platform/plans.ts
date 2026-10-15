import { Plan } from '@prisma/client';

/** What each plan allows. null = no limit. Prices are shown in the app; no payment provider is wired in yet. */
export const PLANS: Record<Plan, { name: string; priceUsd: number; homes: number | null; boards: number | null; staff: number | null; blurb: string }> = {
  STARTER: { name: 'Starter', priceUsd: 0, homes: 5, boards: 25, staff: 3, blurb: 'For a single installer getting started' },
  PRO: { name: 'Pro', priceUsd: 49, homes: 50, boards: 300, staff: 15, blurb: 'For a growing installation business' },
  BUSINESS: { name: 'Business', priceUsd: 199, homes: null, boards: null, staff: null, blurb: 'Unlimited homes, boards and staff' },
};

export const PLAN_ORDER: Plan[] = ['STARTER', 'PRO', 'BUSINESS'];
