/** When to warn about low stock (no imports: the console and the tests use it). */

/**
 * The low-stock warning: tell the super admins once when stock drops below the minimum, and only
 * again after it has gone back up. 'alert' = tell them now; 'reset' = stock is fine again, forget
 * the last warning; null = nothing to do.
 */
export function stockAlert(inStock: number, min: number, alertedAt: Date | null): 'alert' | 'reset' | null {
  if (min <= 0) return alertedAt ? 'reset' : null;
  if (inStock < min) return alertedAt ? null : 'alert';
  return alertedAt ? 'reset' : null;
}
