/** „Vezetéknév Keresztnév" → „V. Keresztnév", a magyar kettős/hármas
 *  kezdőbetűket (Cs, Dzs, Gy…) egyben tartva: „Csiki Anna" → „Cs. Anna". */
const DIGRAPHS = ["dzs", "cs", "dz", "gy", "ly", "ny", "sz", "ty", "zs"]; // hosszabb előbb

export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  const fam = parts[0];
  const lower = fam.toLowerCase();
  let ini = fam.slice(0, 1);
  for (const d of DIGRAPHS) {
    if (lower.startsWith(d)) { ini = fam.slice(0, d.length); break; }
  }
  return `${ini}. ${parts.slice(1).join(" ")}`;
}
