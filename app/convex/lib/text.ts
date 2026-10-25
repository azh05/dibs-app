// Ports of the API's matching helpers (api/app/verify.py, api/app/linking.py), so Convex links and dedupes
// the same way the API does.

/** verify.normalize_url: host + path only, no scheme, www, query, fragment or trailing slash. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  const m = trimmed.match(/^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)([^?#]*)/i);
  let host = (m ? m[1] : "").toLowerCase();
  let path = m ? m[2] : trimmed.replace(/[?#].*$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  path = path.replace(/\/+$/, "");
  return `${host}${path}`.toLowerCase();
}

/** verify._alnum: lowercase letters and digits only. */
export function alnum(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** linking._norm: lowercase words separated by single spaces. */
export function normName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** difflib.SequenceMatcher(None, a, b).ratio(): 2 * matches / total length (Ratcliff/Obershelp). */
export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const matches = (s1: string, s2: string): number => {
    if (!s1 || !s2) return 0;
    let best = 0;
    let i1 = 0;
    let i2 = 0;
    // Longest common substring by dynamic programming (names are short).
    const prev = new Array(s2.length + 1).fill(0);
    for (let i = 1; i <= s1.length; i++) {
      let diag = 0;
      for (let j = 1; j <= s2.length; j++) {
        const keep = prev[j];
        prev[j] = s1[i - 1] === s2[j - 1] ? diag + 1 : 0;
        if (prev[j] > best) {
          best = prev[j];
          i1 = i - best;
          i2 = j - best;
        }
        diag = keep;
      }
    }
    if (!best) return 0;
    return best + matches(s1.slice(0, i1), s2.slice(0, i2)) + matches(s1.slice(i1 + best), s2.slice(i2 + best));
  };
  return (2 * matches(a, b)) / (a.length + b.length);
}

const NAME_MATCH_RATIO = 0.85;

/** linking.names_match: 'Milksha' ~ 'Milksha Westwood', 'CHICHA San Chen - Sawtelle' ~ 'Chicha San Chen'. */
export function namesMatch(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 4 && ` ${long} `.includes(` ${short} `)) return true;
  return similarity(x, y) >= NAME_MATCH_RATIO;
}

/** One key per area, so scans, caches and coord-less deals line up: "westwood|los angeles|california". */
export function areaKey(area: { neighborhood?: string | null; city?: string | null; region?: string | null }): string {
  return [area.neighborhood, area.city, area.region].map((p) => normName(p ?? "")).join("|");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cheap, synchronous content fingerprint for mutations (FNV-1a, 2 × 32 bits), used to skip unchanged sources. */
export function contentHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** "Chicha San Chen" → "CS". */
export function initials(name: string): string {
  return name
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
