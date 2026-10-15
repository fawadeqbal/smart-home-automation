/** Compares firmware versions by their numbers: 2.10.0 > 2.9.1 > 2.9; letters are ignored ("2.2.0-fake" = 2.2.0). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[^\d]+/).filter(Boolean).map(Number);
  const pb = b.split(/[^\d]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The highest version in a list (null for none). */
export function highestVersion(versions: (string | null | undefined)[]): string | null {
  return versions.filter((v): v is string => !!v).sort((a, b) => compareVersions(b, a))[0] ?? null;
}

/**
 * The firmware stamps its version into the binary as "@@HOMENODE-FW:2.3.0@@" (home_node.ino), and boards
 * report exactly that number after installing it. Null for builds made before the stamp existed.
 */
export function versionInBinary(bin: Buffer): string | null {
  return /@@HOMENODE-FW:([\w.\-+]{1,40})@@/.exec(bin.toString('latin1'))?.[1] ?? null;
}

/**
 * Version-looking texts inside a binary ("2.2.0", "3.1.2"…). Builds made before the stamp still contain their
 * FIRMWARE_VERSION as a plain string (next to the ESP8266 core's own version), which is enough to catch an
 * old file uploaded under a new number.
 */
export function versionStrings(bin: Buffer): string[] {
  const found = new Set<string>();
  for (const part of bin.toString('latin1').split('\0')) {
    if (part.length <= 40 && /^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/.test(part)) found.add(part);
  }
  return [...found];
}

/** Of the texts found, the ones most likely to be the firmware's own version (same major number as typed). */
export function likelyVersions(found: string[], typed: string): string[] {
  const major = (v: string) => v.split('.')[0];
  const same = found.filter((v) => major(v) === major(typed));
  return same.length ? same : found;
}
