/**
 * Contract renewals: which contracts to show, how many days are left, the new end date, when to remind.
 * (No imports from the services: billing and the console both use these.)
 */

const DAY = 86_400_000;
/** Contracts ending this soon show under Renewals. */
export const RENEWAL_WINDOW_DAYS = 60;
/** Contracts that ended without a renewal stay on the list this long. */
export const LAPSED_DAYS = 180;
export const TERMS = [3, 6, 12] as const;

/** Whole days from `today` to `endsOn` (both calendar days at midnight UTC): 0 = ends today, negative = ended. */
export const daysLeft = (endsOn: Date, today: Date) => Math.round((endsOn.getTime() - today.getTime()) / DAY);

/** On the Renewals list: ending within the window, or ended (not long ago) and not renewed. */
export function onRenewalList(endsOn: Date | null, today: Date) {
  if (!endsOn) return false;
  const left = daysLeft(endsOn, today);
  return left <= RENEWAL_WINDOW_DAYS && left >= -LAPSED_DAYS;
}

/**
 * The new end date after renewing for `months`: one more term after the current end. A contract that
 * already ended starts its new term today, so the customer isn't billed for the weeks it had lapsed.
 */
export function renewedEnd(endsOn: Date, today: Date, months: number) {
  return addMonths(endsOn < today ? today : endsOn, months);
}

/**
 * Which reminder is due (super admins are told 30 and 7 days before the end, once each).
 * A contract that is already inside 7 days gets only the 7-day one.
 */
export function reminderDue(left: number, sent: { remind30At: Date | null; remind7At: Date | null }): 30 | 7 | null {
  if (left < 0) return null;
  if (left <= 7) return sent.remind7At ? null : 7;
  if (left <= 30) return sent.remind30At ? null : 30;
  return null;
}

/** The same day `months` later, kept inside the month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(day: Date, months: number) {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day.getUTCDate(), last)));
}
