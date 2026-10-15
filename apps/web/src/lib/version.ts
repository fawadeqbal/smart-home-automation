/** Compares firmware versions by their numbers: 2.10.0 > 2.9.1; letters are ignored ("2.2.0-fake" = 2.2.0). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[^\d]+/).filter(Boolean).map(Number);
  const pb = b.split(/[^\d]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** True when `latest` is newer than what the board runs. */
export const isBehind = (running: string | null | undefined, latest: string | null | undefined) =>
  !!(running && latest && compareVersions(latest, running) > 0);

/**
 * What a firmware .bin says about its version: the stamp ("@@HOMENODE-FW:2.3.0@@", builds from the current code)
 * and every version-looking text in it (older builds still contain their FIRMWARE_VERSION as plain text).
 */
export async function inspectFirmware(file: Blob): Promise<{ stamped: string | null; strings: string[] }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const stamped = /@@HOMENODE-FW:([\w.\-+]{1,40})@@/.exec(text)?.[1] ?? null;
  const strings = [...new Set(text.split('\0').filter((p) => p.length <= 40 && /^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/.test(p)))];
  return { stamped, strings };
}

/** Of the version texts in a file, the ones most likely to be the firmware's own (same major number as typed). */
export function likelyVersions(found: string[], typed: string): string[] {
  const major = (v: string) => v.split('.')[0];
  const same = found.filter((v) => major(v) === major(typed));
  return same.length ? same : found;
}
