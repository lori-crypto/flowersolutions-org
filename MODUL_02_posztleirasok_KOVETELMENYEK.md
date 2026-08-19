# Modul 2 — Posztleírások (követelmények és terv)

Állapot: **tervezet, jóváhagyásra vár**
Utolsó frissítés: 2026-08-19
Kapcsolódik: [MODUL_01_szervezesi_tabla_KOVETELMENYEK.md](MODUL_01_szervezesi_tabla_KOVETELMENYEK.md)

## 1. Cél

Minden poszthoz tartozik egy **posztleírás**: az anyag, amiből a poszt betöltője
megtanulja a munkáját. A modul három pillére:

1. **Leírás** — a poszt teljes anyaga (EVT, feladatok, eljárások, tudnivalók)
2. **Szószedet** — a szakszavak és nehezebb szavak definíciói, hogy ne maradjon
   meg nem értett szó
3. **Ellenőrzőlap** — lépésről lépésre végigviszi az új kollégát az anyagon,
   meghatározott sorrendben, feladatokkal; minden lépés igazolt (pipa/aláírás)

## 2. Posztleírás

- Minden `ob_posts` poszthoz 0 vagy 1 **érvényes** leírás + korábbi verziók.
- **Kétnyelvű** (HU/RO), a tábla nyelvi logikájával (hiányzó fordítás → visszaesés).
- Formátum: strukturált szöveg (markdown alapú szerkesztő) — címsorok, listák,
  kép/melléklet beszúrás (Supabase Storage).
- Ajánlott szerkezet (sablon, szerkeszthető):
  1. A poszt megnevezése és helye a táblán (automatikus a tábláról)
  2. A poszt EVT-je (a tábláról, szinkronban)
  3. Cél és felelősségek
  4. Feladatok és eljárások
  5. Kapcsolódó irányelvek (később az Irányelvek modulra linkel)
  6. Statisztikák (később)
- **Verziózás:** kiadáskor (publikálás) új verziószám; a régi verziók megmaradnak,
  olvashatók. Vázlat (draft) állapot szerkesztés alatt.
- **Nyomtatható nézet:** tiszta, A4-re optimalizált elrendezés (leírás +
  ellenőrzőlap aláírás-sorokkal).

## 3. Szószedet (a meg nem értett szavak kezelése)

### 3.1 Belső szószedet — ez az elsődleges

- Céges **szószedet-tár**: kifejezés + egyszerű nyelvű definíció (HU/RO) +
  **példamondat** (kötelező mező — a példa többet ér, mint a definíció).
- A definíciókat **mi írjuk, egyszerű szavakkal** — így garantált, hogy nem
  definiálunk meg nem értett szót másik meg nem értett szóval.
- Egy kifejezés lehet **globális** (az egész cégben ugyanaz) vagy
  **poszt-specifikus** (csak az adott leíráshoz kötve).
- **Automatikus kiemelés:** a leírás szövegében a szószedetben szereplő szavak
  halványan alá vannak húzva; koppintás/kattintás → buborékban a definíció + példa.
- A leírás-szerkesztőben egy gombbal: kijelölt szó → „Felvétel a szószedetbe".

### 3.2 Külső szótár — segédeszköz

Ha egy szó nincs a szószedetben, az olvasó kijelölheti és rákereshet:

| Nyelv | Forrás | Integráció | Megjegyzés |
|---|---|---|---|
| RO | **dexonline.ro** | JSON lekérdezés szerveroldali proxyn át (`/definitie/<szó>/json`), GPL-adatbázis | A román referencia-szótár; megbízható, teljes |
| HU | **WikiSzótár.hu** | link megnyitása (nincs publikus API-ja) | Kifejezetten egyszerű, érthető definíciókra és példamondatokra épül — pont a mi igényünk |
| HU | eksz.nytud.hu (Értelmező kéziszótár) | link | tudományos tartalék |

- A külső találat mellett mindig ott a gomb: **„Vedd fel a szószedetbe"** — a
  szerkesztő átfogalmazhatja egyszerűbbre. Így a szószedet folyamatosan hízik,
  és egyre ritkábban kell külső szótár.
- A dexonline-válaszokat szerveroldalon gyorsítótárazzuk (ne terheljük őket).

## 4. Ellenőrzőlap (checksheet)

- Minden poszthoz tartozhat egy **ellenőrzőlap**: rendezett lépéssor, ami
  végigviszi az új kollégát az anyagon.
- **Lépéstípusok:**
  - `olvasás` — a leírás egy szakaszának (vagy mellékletnek) elolvasása
  - `elméleti feladat` — kérdés megválaszolása, fogalom meghatározása saját
    szavakkal, demonstráció leírása
  - `gyakorlati feladat` — tényleges munkafolyamat elvégzése a gyakorlatban
    (pl. „Vegyél át egy beérkező árut a raktárvezető felügyeletével")
- Minden lépésnek van: sorszám (kötött sorrend), cím, útmutató szöveg (HU/RO),
  hivatkozás az anyagra (a leírás szakaszára vagy mellékletre).
- **Sorrend-kényszer:** a következő lépés zárolt, amíg az előző nincs igazolva.

### 4.1 Igazolás (pipa / aláírás)

- **Digitális út:** a kolléga bejelentkezve kipipálja a lépést → a rendszer
  rögzíti: ki, mikor (időbélyeg), melyik lépést. Ez a digitális „aláírás".
  Pipa nélkül a következő lépés nem nyitható.
- **Elméleti lépésnél** a pipa önmagában nem elég: **kötelező a válasz beírása**
  (a pipa csak az aláírást helyettesíti). **Gyakorlati lépésnél** a kolléga pipája
  után **HR-ellenjegyzés** is kell a lépés lezárásához.
- **Nyomtatott út:** a nyomtatható ellenőrzőlapon minden lépés mellett
  dátum + aláírás sor. A kitöltött papír alapján egy jogosult személy
  (vezető/admin) utólag rögzíti digitálisan a haladást.
- Pipa **visszavonása** csak jogosultsággal (vezető/admin), naplózva.
- Minden esemény az `audit_log`-ba is kerül.

### 4.2 Haladás-követés

- Személyenként és posztonként: hol tart, mikor kezdte, mikor fejezte be.
- **Vezetői nézet:** az alosztály-/osztályvezető látja a saját embereinek
  haladását; az ügyvezető mindenkiét.
- Befejezéskor a rendszer rögzíti: „X. verziójú posztleírást elvégezte" —
  ha később új verzió jelenik meg, jelezhető, hogy frissítés szükséges.

## 5. Adatmodell (vázlat)

```
post_descriptions   — poszt_id, verzió, státusz (vázlat/érvényes/archív),
                      content_hu, content_ro, létrehozó, publikálva
description_assets  — leírás_id, fájl (Storage), típus (kép/pdf), sorrend
glossary_terms      — kifejezés, definíció_hu/ro, példa_hu/ro,
                      hatókör (globális | poszt_id), létrehozó
checksheets         — poszt_id, verzió, státusz, cím_hu/ro
checksheet_steps    — checksheet_id, sorrend, típus (olvasás/elméleti/gyakorlati),
                      cím_hu/ro, útmutató_hu/ro, anyag-hivatkozás
checksheet_progress — person_id, step_id, elvégezve (időbélyeg),
                      válasz (elméleti lépésnél kötelező szöveg),
                      hr_ellenjegyzés (person_id + időbélyeg, gyakorlati lépésnél),
                      rögzítette (maga / HR papír alapján), megjegyzés
description_access  — delegálás: person_id, poszt_id, ki adta, mikortól/meddig
```

Jogosultságok (a meglévő capability-rendszerre építve):
- `posztleiras.szerkesztes` — leírás, szószedet, ellenőrzőlap szerkesztése/kiadása;
  minden leírást lát
- `hr` — minden leírást lát; gyakorlati lépések ellenjegyzése; papír alapú haladás
  rögzítése; válaszok megtekintése
- olvasás: a **saját poszt(ok)** leírása + amihez **delegálással** hozzáférést
  kapott (`description_access`) + admin/szerkesztő/HR
- haladás: mindenki a sajátját pipálja (elméleti lépésnél kötelező válasszal);
  gyakorlati lépés lezárásához HR-ellenjegyzés kell
- visszavonás/javítás: admin vagy `posztleiras.szerkesztes`, naplózva

## 6. UI (vázlat)

- **Belépési pont:** a táblán a poszt-buborék „Posztleírás →" linkje (már ott a
  helye) + külön „Posztleírások" menüpont listanézettel (melyik posztnak van/nincs
  leírása — a hiány is látszik).
- **Olvasó nézet:** tiszta, olvasásra tervezett oldal; szószedet-kiemelések;
  jobb oldalt/alul az ellenőrzőlap a haladással („3/12 lépés kész").
- **Ellenőrzőlap nézet:** lépések listája — kész (zöld pipa + dátum), aktuális
  (nyitva, pipálható), zárolt (szürke lakat). Mobilon is kényelmes.
- **Szerkesztő:** markdown-szerkesztő élő előnézettel; szószedet-kezelő;
  ellenőrzőlap-építő (lépések sorrendje ↑↓, típus, szövegek); „Kiadás" gomb
  (verziózás).
- **Nyomtatás:** leírás + ellenőrzőlap aláírás-sorokkal, A4, fejlécben a poszt
  és a verzió.

## 7. Ütemezés (javaslat)

1. **1. ütem:** adatmodell + leírás írás/olvasás + belső szószedet kiemeléssel
   + egyszerű ellenőrzőlap pipálással és sorrend-kényszerrel
2. **2. ütem:** nyomtatható nézet, papír-alapú rögzítés, vezetői haladás-nézet
3. **3. ütem:** dexonline-integráció, verzió-frissítési jelzések, sablonok

## 8. Eldöntött kérdések (2026-08-19)

1. **Olvasási jog: szűkített.** A kolléga csak a **saját posztjainak** leírását
   látja, VAGY azt, amihez **delegálás útján** hozzáférést kapott (feladat-delegálás
   → a kapcsolódó posztleírás megnyílik neki). Ezen felül: admin, a
   `posztleiras.szerkesztes` jogú szerkesztők és a HR-szerepű személyek látnak mindent.
   → kell egy **hozzáférés-delegálás** tábla: kinek, melyik poszt leírásához,
   ki adta, meddig.
2. **Ellenjegyzés: a HR-es adja, nem a vezető.** A gyakorlati feladat-lépéseknél
   a kolléga pipája mellett a **HR-szerepű személy igazolása** is kell a lépés
   lezárásához. → új capability: `hr` (ellenjegyzés + minden leírás olvasása +
   papír alapú haladás rögzítése).
3. **Elméleti feladat: kötelező válasz.** A lépés csak akkor zárható, ha a kolléga
   **beírta a választ** (szöveges mező); a pipa csupán az aláírást helyettesíti.
   A válaszok megtekinthetők a HR és a szerkesztők számára.
4. **A vezetői posztok is kapnak ellenőrzőlapot** (alosztály-, osztály-,
   csoportvezető, ügyvezető) — ugyanaz a mechanizmus.
