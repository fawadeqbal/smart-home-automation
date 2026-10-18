/** Quote lines and totals: plain maths, shared by the console, the public quote page and the tests. */

export interface QuoteLine {
  /** the price-list item it came from (null: typed in by hand) */
  priceItemId: string | null;
  name: string;
  unit: string;
  qty: number;
  /** rupees for one */
  price: number;
}

export const MAX_LINES = 60;
const MAX_QTY = 9999;
const MAX_PRICE = 10_000_000;

const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** What the screen sent, made safe: names trimmed, whole rupees, at least one of each; empty lines dropped. */
export function cleanLines(input: unknown): QuoteLine[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => (x ?? {}) as Record<string, unknown>)
    .map((x) => ({
      priceItemId: typeof x.priceItemId === 'string' && x.priceItemId ? x.priceItemId.slice(0, 40) : null,
      name: String(x.name ?? '').trim().slice(0, 120),
      unit: String(x.unit ?? 'each').trim().slice(0, 20) || 'each',
      qty: int(x.qty, 1, MAX_QTY, 1),
      price: int(x.price, 0, MAX_PRICE, 0),
    }))
    .filter((l) => l.name.length > 0)
    .slice(0, MAX_LINES);
}

export const lineTotal = (l: Pick<QuoteLine, 'qty' | 'price'>) => l.qty * l.price;

/** Subtotal, the discount (never more than the subtotal, never negative) and what the customer pays. */
export function quoteTotals(lines: Pick<QuoteLine, 'qty' | 'price'>[], discount: number) {
  const subtotal = lines.reduce((a, l) => a + lineTotal(l), 0);
  const off = Math.min(subtotal, Math.max(0, Math.round(Number(discount) || 0)));
  return { subtotal, discount: off, total: subtotal - off };
}

/** The number people see: "Q-12". */
export const quoteRef = (n: number) => `Q-${n}`;

/**
 * "What to install" for a home: the items of its accepted quotes, the same item added up across
 * quotes (labour and wiring are work, not things to fit, but they stay on the list as a reminder).
 */
export function acceptedItems(quotes: { number: number; decidedAt: Date | null; items: QuoteLine[] }[]) {
  const rows: { name: string; unit: string; qty: number }[] = [];
  for (const q of quotes) {
    for (const l of q.items) {
      const same = rows.find((r) => r.name.toLowerCase() === l.name.toLowerCase() && r.unit === l.unit);
      if (same) same.qty += l.qty;
      else rows.push({ name: l.name, unit: l.unit, qty: l.qty });
    }
  }
  return { quotes: quotes.map((q) => ({ ref: quoteRef(q.number), acceptedAt: q.decidedAt })), items: rows };
}
