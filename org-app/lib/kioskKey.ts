import { createHmac, timingSafeEqual } from "crypto";

// KIZÁRÓLAG szerveroldalon! A kijelző-oldalak (falra tett monitor) belépés nélkül,
// egy hosszú, kitalálhatatlan kulccsal olvasnak — a kulcs a kioszk-böngésző címében van.
//
// A kulcs forrása:
//   1) KIJELZO_SECRET környezeti változó, ha be van állítva (önálló, külön cserélhető);
//   2) különben a CRON_SECRET-ből képzett egyirányú lenyomat (HMAC-SHA256) — a cron-titok
//      ebből nem fejthető vissza, és nem kell hozzá új beállítás a Vercelen.
// Minden kijelzőnek saját „cél" neve van (pl. "szabadsag"), így a kulcsok nem felcserélhetők.

const clean = (v?: string) => (v ?? "").trim().replace(/^["']+|["']+$/g, "");

export function kioskKey(scope: string): string | null {
  const own = clean(process.env.KIJELZO_SECRET);
  const base = own || clean(process.env.CRON_SECRET);
  if (!base) return null;
  return createHmac("sha256", base).update("kijelzo:" + scope).digest("hex").slice(0, 40);
}

export function kioskKeyOk(scope: string, given: string | null | undefined): boolean {
  const want = kioskKey(scope);
  if (!want || !given) return false;
  const a = Buffer.from(want), b = Buffer.from(String(given));
  return a.length === b.length && timingSafeEqual(a, b);
}
