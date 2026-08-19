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
- ⏳ Posztleírások modul — **követelmények és terv kész**
  (`MODUL_02_posztleirasok_KOVETELMENYEK.md`), 4 nyitott kérdés vár válaszra;
  utána jöhet az 1. ütem építése
- ⏳ Változásnapló nézet + visszavonás admin felületen (a napló már gyűlik)

## Későbbi modulok

Pénzügy (NEXUS-szinkron), Projekt, HR, Irányelvek — lásd `TECHNIKAI_TERV.md`.
