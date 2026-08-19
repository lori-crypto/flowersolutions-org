# Technikai terv — Management rendszer

Állapot: **jóváhagyva 2026-08-19-én** (minden döntés elfogadva)
Domain: **org.flowersolutions.ro**
Utolsó frissítés: 2026-08-19

Kapcsolódó dokumentumok:
- [MODUL_01_szervezesi_tabla_KOVETELMENYEK.md](MODUL_01_szervezesi_tabla_KOVETELMENYEK.md)
- Referencia: a webshop-projekt `ARCHITEKTURA.md`-ja és `NEXUS_BI_API_UTMUTATO.md`-ja
  (`C:\DEV\CLOUDE\AJANLAT WEBES FELULETEN\uj-rendszer\`)

---

## 1. Stack-javaslat

**Ugyanaz a bevált stack, mint a webshopé:**

| Réteg | Technológia | Miért |
|---|---|---|
| Alkalmazás | **Next.js (App Router) + React + TypeScript** | Egyben frontend + szerveroldali API; PWA-vá tehető; a webshopból ismert minták átvihetők |
| Hosting + cron | **Vercel** | main-re push = auto-deploy; ütemezett feladatok (ERP-szinkron); titkok kezelése |
| Backend | **Supabase** (Postgres + Auth + RLS + Storage + RPC) | Soronkénti jogosultság (RLS) = a többfelhasználós, szerepkör-alapú rendszer alapja; bevált a webshopban |
| Email | **Resend** | Tranzakciós levelek (meghívó, jelszó-visszaállítás, később értesítések) |
| Verziókezelés | **GitHub** | Deploy-trigger + történet |

Miért nem más:
- *Saját VPS / önhosztolt stack:* több üzemeltetés, kevesebb előny; a Vercel+Supabase
  ingyenes/olcsó szinten indulható és skálázódik.
- *Külön backend (Node/NestJS stb.):* felesleges réteg — a Supabase RLS + RPC minta
  a webshopban bizonyított, és a csapat (mi) már ismerjük a buktatóit.

**Külön Supabase-projekt és külön GitHub-repo** a webshoptól. Indok: más felhasználói
kör, más jogosultsági logika, más életciklus; a webshop éles rendszerét nem
kockáztatjuk. A webshop-adatok átvétele (rendelésszám, értékek) külön szinkronnal
történik (lásd 8. pont), nem közös adatbázissal.

## 2. Alkalmazás-szerkezet: moduláris monolit

Egyetlen Next.js alkalmazás, a modulok route-csoportok:

```
app/
  (auth)/login, elfelejtett-jelszo …
  tabla/            ← Modul 1: szervezési tábla
  posztleirasok/    ← Modul: posztleírások (a táblához kötve)
  penzugy/          ← Modul 2 (később)
  projektek/        ← Modul 3 (később)
  hr/               ← Modul 4 (később)
  iranyelvek/       ← Modul 5 (később)
  api/              ← szerveroldali route-ok (ERP-szinkron, email, admin)
lib/                ← közös mag: supabase kliens, jogosultság, i18n, UI-komponensek
sql/                ← számozott, idempotens migrációk (webshop-konvenció)
```

Elv: **közös mag** (bejelentkezés, jogosultság, kétnyelvűség, design-rendszer,
navigáció) + modulonként saját táblák/route-ok. Új modul = új mappa + új SQL-fájlok,
a mag nem változik.

## 3. Adatmodell — alapréteg (minden modul erre épül)

### 3.1 Személyek és fiókok

```
persons        — a SZEMÉLY törzse (HR-rel közös): név, email, telefon, nyelv (hu/ro), aktív-e
auth.users     — Supabase Auth fiók (email+jelszó); 1:1 kapcsolat a persons-szal (user_id)
```

Elv: a *személy* és a *fiók* külön fogalom — lehet személy fiók nélkül (pl. még nem
kapott hozzáférést), és a poszt-hozzárendelés a személyhez kötődik, nem a fiókhoz.

### 3.2 Szervezési tábla (Modul 1)

```
org_settings      — 1 sor: a szervezet neve + EVT (hu/ro)
ob_groups         — osztálycsoportok (A: 7/1/2, B: 3/4/5/6): címke (hu/ro), sorrend
ob_divisions      — osztályok: csoport_id, jelzés ("4A"), név (hu/ro), EVT (hu/ro), szín, sorrend
ob_departments    — alosztályok: osztály_id, sorszám, név (hu/ro), EVT (hu/ro), sorrend
ob_posts          — posztok: alosztály_id*, név (hu/ro), EVT (hu/ro), vezetői szint
                    (nincs / alosztályvezető / osztályvezető / csoportvezető / ügyvezető), sorrend
ob_post_holders   — poszt ↔ személy (N:N): mettől (valid_from) meddig (valid_to, NULL = aktív)
```

\* A vezetői posztok elhelyezése: az ügyvezetői és csoportvezetői poszt nem
alosztályhoz, hanem a szervezethez/csoporthoz kötődik → az `ob_posts`-ban az
`alosztály_id` mellett opcionális `osztály_id` / `csoport_id` / `szervezet` horgony
is lehet (pontosan egy horgony kötelező). A „vezetői szint" mező mondja meg, minek a
vezetője.

Történetiség: a `valid_from`/`valid_to` a hozzárendeléseknél; a struktúra-változásokat
az audit-napló őrzi.

### 3.3 Posztleírások (kapcsolódó modul)

```
post_descriptions — poszt_id, tartalom (hu/ro, rich text/markdown), verzió, státusz
                    (vázlat/érvényes), ki írta, mikor
```

Verziózott: új kiadás új sor, a régi megmarad. A poszt EVT-je a táblában él
(ob_posts), a leírás hivatkozik rá.

### 3.4 Jogosultság

Két réteg:

1. **Szerep a tábláról származtatva:** aki aktív betöltője egy vezetői posztnak, az
   automatikusan az adott szint vezetője (ügyvezető > csoportvezető > osztályvezető >
   alosztályvezető > munkatárs). A tábla = az igazság forrása a hierarchiáról.
2. **Explicit képességek (capability):** finomhangolás, pl. `tabla.szerkesztes`,
   `penzugy.megtekintes`, `admin`. Táblája: `capabilities` + `person_capabilities`.
   Alapértelmezés: a tábla szerkesztése csak ügyvezető/admin.

Megvalósítás a webshop-mintára: RLS minden táblán + `SECURITY DEFINER` RPC-k
(`app_is_admin()`, `app_can(...)` jellegű segédfüggvények), a kliens csak anon
kulcsot lát.

### 3.5 Audit és visszavonás

```
audit_log — ki (person_id), mikor, melyik tábla/sor, művelet (insert/update/delete),
            előtte-utána JSON
```

Minden táblaszerkesztő RPC ír bele. A „visszavonás" admin funkció: az előtte-JSON
visszaírása (szintén naplózva).

## 4. Kétnyelvűség (RO/HU)

- **Felhasználói adat** (nevek, EVT-k, leírások): `_hu` és `_ro` oszloppárok.
  A felület a felhasználó nyelvén mutatja, üres fordításnál a másik nyelvre esik
  vissza, és jelzi, hogy hiányzik a fordítás.
- **Felületi szövegek** (gombok, címkék): szótárfájlok (`hu.json`, `ro.json`),
  egyszerű saját `t()` helper vagy next-intl.
- A nyelvet a `persons.lang` tárolja; váltó a fejlécben.

## 5. PWA

- `manifest.json` + ikonok + telepíthetőség (Add to Home Screen).
- Service worker: első körben **app-shell cache** (gyors indulás) + a szervezési
  tábla **olvasó offline cache-e** (utolsó letöltött állapot megnézhető net nélkül).
  Írás offline nincs (felesleges komplexitás).
- Mobil-first felület: a tábla oszloponként lapozható nézete (a prototípusból).

## 6. Bejelentkezés

- Supabase Auth, **email + jelszó**. (A webshop felhasználónév→email trükkje itt nem
  kell: a kollégáknak van céges/saját emailjük — meghívó emaillel aktiválnak.)
- Meghívásos flow: admin felvesz egy személyt + email → Resend-del meghívó → jelszó
  beállítása. Elfelejtett jelszó: standard reset email.
- Session: Supabase kezelt token, PWA-ban is működik.

## 7. ERP-szinkron (Pénzügy modul alapja — később építjük, most csak az illesztés)

A webshop-mintát követi:
- NEXUS-hívás **kizárólag szerveroldali** route-okból (`NEXUS_HOST`, `NEXUS_API_KEY`
  env-ben), Vercel cron éjszakánként.
- Betöltés a saját Postgres-be: **tény-táblák `source` oszloppal** (`nexus`,
  `webshop`, …) — többforrású pénzügyi adatmodell.
- **Konfigurálható szűrőszabályok** táblában (nem beégetve): pl. az overnight
  szerződések ki-be mozgásának kizárása. Szabály = feltétel (partner, bizonylattípus,
  megjegyzés-minta…) + hatás (kihagy/besorol).
- Futó + előző hónap újratöltése minden futáskor (NEXUS-ban visszamenőleg is
  módosulhat bizonylat); `anluna` (YYYYMM) granularitás.

## 8. Webshop-adatok átvétele (később)

A webshop Supabase-éből ütemezett, read-only átemelés (rendelésszám, értékek) egy
szerveroldali route-tal — ugyanaz a mintázat, mint a NEXUS-szinkron, `source =
'webshop'`. Amikor a pénzügy/statisztika modul itt elkészül, a webshopból ezek a
funkciók kivezethetők.

## 9. Migrációk, környezetek, minőség

- **Számozott, idempotens SQL-fájlok** (`01_alap.sql`, `02_orgboard.sql`, …), kézi
  futtatás a Supabase SQL Editorban — a webshopban bevált konvenció.
- Git: `main` = éles (auto-deploy Vercelre). Fejlesztés feature-ágakon.
- Push előtti ellenőrzés: `npx tsc --noEmit`.
- Titkok kizárólag `NEXT_PUBLIC_` nélküli env-változókban a Vercelen.

## 10. Nyitott döntések (jóváhagyásra)

1. **Stack:** a fenti (webshop-minta) rendben? — *javaslat: igen*
2. **Külön Supabase-projekt + külön repo** a webshoptól? — *javaslat: igen*
3. **Belépés:** email+jelszó meghívóval? — *javaslat: igen*
4. **Domain:** hol lakjon az app? (pl. `management.flowersolutions.ro` — Vercelre
   kötve) — *név kell*
5. **Offline szint:** olvasó offline cache elég? — *javaslat: igen, írás csak online*
