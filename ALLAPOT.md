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

## Következik

- ⏳ **Lóri teendői:** GitHub-repo + Vercel + org.flowersolutions.ro
  (`BEALLITAS.md` 3–4. pont)
- ⏳ Service worker (olvasó offline cache)
- ⏳ Meghívó emailes fiók-létrehozás (Resend) — admin felület személyekhez/fiókokhoz
- ⏳ Posztleírások modul (következő modul, a táblához kötve)
- ⏳ Változásnapló nézet + visszavonás admin felületen (a napló már gyűlik)

## Későbbi modulok

Pénzügy (NEXUS-szinkron), Projekt, HR, Irányelvek — lásd `TECHNIKAI_TERV.md`.
