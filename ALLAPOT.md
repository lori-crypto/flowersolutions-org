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

- ✅ **Éjszakai NEXUS-szinkron ÉL** (2026-08-24): Vercel cron 1:20 UTC →
  `/api/sales-sync` → futó+előző hónap teljes cseréje az API-ból (source:
  nexus_api). Számla-szintű hitelesítés: aug. 668/668 fillérre, júl. 1091/1092.
  Tanulságok: az API kedvezménye KÜLÖN negatív sor (procent_discount csak infó),
  ÁFA a cota_tva_ies mezőből (21%), érték = mennyiség × egységár.

- ✅ **Webshop-előrendelés szinkron ÉL** (2026-08-24): `/api/webshop-sync` + cron
  1:40 UTC → webshop_order_lines (14 569 sor, 98% nexus_id_client-tel) +
  webshop_cycles; sales_lines.id_client feltöltve a NEXUS-fejekből.
  Terv: `TERV_statisztika_bi_atvetel.md` (döntések: éjszakai elég, párhuzamos
  futás a webshoppal, compare kezdőhét 2026-07-22).
  **Teendő: WEBSHOP_SUPABASE_URL + WEBSHOP_SERVICE_KEY env a Vercelen** (a
  helyi org-app/.env.local-ban megvannak), különben az éjszakai cron nem fut.
  **Következik: a BI/Statisztika felület megtervezése és megépítése.**

- ✅ **Statisztika modul ÉL** (2026-08-24): Haladás főoldal (előrendelés-kártya
  bruttón + hét/hónap/év vs tavaly, naptár-alapú hetekkel), Eladások BI
  (év-gombok, év/év és ügyfél×év csoportosított oszlopok, gépelhető
  ügyfél-kereső), Előrendelés vs számlázott (bruttó-bruttó Δ%).
  NEXUS comenzi-szinkron 2 óránként (`/api/orders-sync`, 12,3 ezer rendelés
  2024-től) → hiteles szállításinap-naptár (vasárnap/hétfő kis napok kizárva;
  125 szerda + 15 csütörtök validálva). SQL: 11–16. A 📦 kártya akkor jelenik
  meg, ha a köv. szállításra már van rendelés a NEXUS-ban.
  Későbbre: speciális időszakok (Valentin, márc. 8.) egyedi intervallumokkal —
  Lóri adja meg évenként; nexus-probe végpont eltávolítása, ha már nem kell.

## Későbbi modulok

Pénzügy (NEXUS-szinkron), Projekt, HR, Irányelvek — lásd `TECHNIKAI_TERV.md`.
