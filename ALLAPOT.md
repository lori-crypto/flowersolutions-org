# Projekt-állapot

Utolsó frissítés: 2026-08-19

## Kész

- ✅ Dokumentálódás: org board források, követelmények (Modul 1), technikai terv
- ✅ UI-prototípus: `TERV_szervezesi_tabla_UI_mockup.html` (jóváhagyott kinézet)
- ✅ Next.js app váz: `org-app/` (Next 16, TypeScript, App Router)
- ✅ SQL-migrációk: `sql/01_alap.sql` (személyek, jogosultság, audit),
  `sql/02_orgboard.sql` (tábla-struktúra), `sql/03_orgboard_seed.sql` (7/21 kiindulás)
- ✅ Belépés (email+jelszó, elfelejtett jelszó), kétnyelvű mag (HU/RO), PWA manifest
- ✅ Szervezési tábla modul (`/tabla`): a jóváhagyott teljes-táblás nézet adatbázisból,
  szerkesztő mód (csak `tabla.szerkesztes`/`admin` képességgel), űrlapos szerkesztés,
  személy-hozzárendelés (történetiséggel), audit-napló triggerekkel
- ✅ `npm run build` zöld
- ✅ Supabase-projekt él (flowersolutions org, Frankfurt), migrációk lefuttatva,
  admin fiók működik — **helyben futó, működő rendszer** (2026-08-19)
- ✅ Kiinduló struktúra román fordítással (Divizia/Departamentul/Șef …)
- ✅ Poszt-EVT lebegő buborékban (nem ugráltatja a táblát)
- ✅ Osztályok mozgatása ◀ ▶ nyilakkal + csoportváltás űrlapon; alosztályok ↑ ↓

- ✅ GitHub: https://github.com/lori-crypto/flowersolutions-org (main → auto-deploy)
- ✅ Vercel production él: https://flowersolutions-org-six.vercel.app
- ✅ Mobil UI csiszolás (telefonon jóváhagyva): A/B csoport egy sorban fele-fele,
  osztályválasztó csík ki, nyelvválasztó legördülő, nagy érintőfelületek
- ✅ ↻ frissítés gomb (teljes újratöltés: app-kód + adat) + automatikus adat-frissítés
  előtérbe kerüléskor (PWA)
- ✅ Vissza-gesztus javítva (login nem marad az előzményekben) — telefonon ellenőrizve
- ✅ Osztályfejléc: név + vezető középen, felirat nélkül
- ✅ Személyek rendezve: Kovacs Lorand (admin, lori@...), Kovacs Borbala
  (flori.mures@..., olvasó) — fiókok személyekhez kötve, duplikátum törölve

## Következik

- ⏳ **Lóri teendője:** org.flowersolutions.ro domain — Vercel „Add Custom Domain”
  + DNS CNAME (`org` → `cname.vercel-dns.com`)
- ⏳ Service worker (olvasó offline cache)
- ⏳ Meghívó emailes fiók-létrehozás (Resend) — admin felület személyekhez/fiókokhoz
- 🔨 Posztleírások modul **1. kör MEGÉPÍTVE** (2026-08-23): teljes adatmodell
  (`sql/08_posztleirasok.sql` — **futtatandó!**), lista + részletes oldal,
  kétnyelvű markdown-szerkesztő verziózott kiadással, szószedet automatikus
  kiemeléssel + kattintható definíció-buborék, olvasási jog (betöltő/delegált/HR).
  **Hátravan (2. kör): ellenőrzőlap-felület** (lépések szerkesztése, pipálás
  sorrend-kényszerrel, elméleti válasz, HR-ellenjegyzés — az adatmodell és az
  RPC-k már készen vannak), delegálás-kezelő UI, nyomtatható nézet.
- ⏳ Változásnapló nézet + visszavonás admin felületen (a napló már gyűlik)

- ✅ Szabadságos tábla modul **1. ütem MEGÉPÍTVE** (2026-08-19): 3 egység-tábla
  (Lerakat, Virágüzlet 1-2), hónap/év nézet, önkiszolgáló beírás fél nappal,
  szabályok DB-szinten (zárolt napok, táblánként állítható napi korlát,
  versenybiztos), keret-számláló, HR-panel (tagok/korlát/zárolás/keretek),
  RO ünnepnapok 2027-re. **Teendő: `sql/04_szabadsag.sql` futtatása a Supabase-ben!**
  Hátravan (2-3. ütem): ügyelet-beosztás + csere, értesítések, nyomtatás.

- ✅ **Értékesítési adatvagyon betöltve** (2026-08-24): `sales_lines` tábla,
  **419 619 számlasor** (2024: 139 425, 2025: 163 920, 2026 jan–aug: 116 274),
  minden hónap sorra egyeztetve a forrás-CSV-kkel. Valós értékek előre számolva
  (kedvezmény + 2 aviz-ügyfél −5%); beszerzési érték is bent (árrés-elemzéshez).
  Export-formátum hitelesítve a NEXUS-szal (fillérre). Olvasás: csak HR/admin.
  Betöltő: `scripts/load_sales.py`; forrásfájlok: `adatok/` (gitből kizárva).

## Későbbi modulok

Pénzügy (NEXUS-szinkron), Projekt, HR, Irányelvek — lásd `TECHNIKAI_TERV.md`.
