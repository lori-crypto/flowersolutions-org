# Modul 1 — Szervezési tábla (követelmények)

Állapot: **dokumentálódás** (követelmények rögzítése; tervezés és építés később)
Utolsó frissítés: 2026-08-19

## 1. Cél és szerep

A szervezési tábla a teljes rendszer alapja. L. Ron Hubbard 7 osztályos / 21 alosztályos
org boardjának mintájára a **teljes szervezet** felkerül egy táblára. Minden más modul
(pénzügy, projekt, HR, irányelvek, posztleírások…) erre a vázra kapcsolódik.

Alapelv: **a táblára posztok kerülnek, nem személyek.** A személyeket utólag rendeljük
a posztokhoz.

## 2. A struktúra szabályai

Hierarchia fentről lefelé:

```
Szervezet
└── Ügyvezető (jelenleg: a tulajdonos)
    ├── A-csoport (vezetővel)  → 7., 1., 2. osztály
    └── B-csoport (vezetővel)  → 3., 4., 5., 6. osztály
        └── Osztály (division) — mindegyiknek saját vezetője
            └── Alosztály (department) — mindegyiknek saját vezetője
                └── Poszt — 1 vagy több személy foglalhatja el
```

Részletes szabályok:

- **7 osztály**, két csoportban: az első csoport a **7, 1, 2**, a második a **3, 4, 5, 6**.
  Mindkét csoportnak külön vezetője van.
- Minden **osztálynak** külön vezetője van.
- Minden osztályban **3 vagy több alosztály** lehet (a 3 a kiindulás, bővíthető).
- Az osztályok száma is bővíthető: pl. a 4-es osztály kettéosztható **4A és 4B** osztályra.
- Minden **alosztálynak** vezetője van.
- Minden alosztályban **n poszt** létezhet.
- Minden posztot **1 vagy több személy** foglalhat el.
- Minden elem (csoport, osztály, alosztály, poszt) neve/tartalma **szerkeszthető** —
  a rendszer a szerkezetet adja, az elnevezéseket a felhasználó tölti fel.

## 3. Értékes Végtermék (EVT)

Minden szintnek van EVT-je (értékes végterméke):

| Szint | EVT megjelenítés a táblán |
|---|---|
| Szervezet | látható a táblán |
| Osztály | látható a táblán |
| Alosztály | látható a táblán |
| Poszt | **nem** a táblán (túlzsúfolná) — a posztleírásban, ill. rejtve: pl. hover/koppintás jeleníti meg |

## 4. Kapcsolódó modul: Posztleírások

- Minden poszthoz tartozik egy **leírás** — ez külön modul lesz „Posztleírások" néven,
  a szervezési táblával összekötve.
- A poszt EVT-je a posztleírás része.
- (A posztleírások modul részletes követelményei később.)

## 5. UX-elvárások

- **Kiemelten felhasználóbarát** felület, desktopon ÉS mobilon egyaránt
  („nagyon nagyon nagyon felhasználóbarát").
- Minden szerkeszthető a felületről: elnevezések, EVT-k, struktúra (alosztály hozzáadás,
  osztály bővítés/kettéosztás, posztok kezelése, személyek hozzárendelése).
- A poszt-EVT rejtett megjelenítése: desktopon hover, mobilon koppintás/kibontás.

## 6. Kapcsolódások más modulokhoz (előrejelzés)

- **Posztleírások modul** — közvetlen kapcsolat (4. pont).
- **Jogosultsági rendszer** — a szerepkörök várhatóan a tábla posztjaihoz/szintjeihez
  kötődnek majd (ügyvezető, csoportvezető, osztályvezető, alosztályvezető, poszt-birtokos).
- **HR modul** — személyek törzse; a poszt–személy hozzárendelés metszéspont.
- **Pénzügy/statisztika** — később valószínűleg szintekhez/posztokhoz kötött mutatók.

## 7. Konceptuális adatmodell (első vázlat, még nem terv!)

- `organization` — név, EVT (RO/HU)
- `group` — a két (vagy több) osztálycsoport; név, sorrend
- `division` — osztály; csoporthoz tartozik; név, sorszám/jelzés (pl. „4A"), EVT, sorrend
- `department` — alosztály; osztályhoz tartozik; név, EVT, sorrend
- `post` — poszt; alosztályhoz tartozik; név, EVT, kapcsolat a posztleíráshoz
- `person` — személy (a HR modullal közös törzs)
- `post_assignment` — poszt ↔ személy (több-több), időbeliséggel (mettől meddig)
- Vezetői szerep: a csoport/osztály/alosztály **vezetője** valószínűleg maga is egy
  poszt, „vezetői" jelöléssel — lásd nyitott kérdések.
- Minden névmező és EVT **kétnyelvű** (RO/HU).

## 8. Eldöntött kérdések (2026-08-19)

1. **A vezetők maguk is posztok.** ✔ A csoportvezető, osztályvezető, alosztályvezető
   egy-egy poszt, „vezető" jelöléssel az adott egységhez kötve. A személy-hozzárendelés
   ugyanúgy működik, mint bármely posztnál.
2. **Egy személy több posztot is betölthet.** ✔
3. **Üres poszt megengedett.** ✔ A tábla a *kívánt* struktúrát mutatja; a betöltetlen
   poszt látványosan jelölve (vezetői információ is).

## 9. Elfogadott alapértelmezések (szólj, ha másképp kell)

4. **EVT:** egy fő EVT szintenként (Hubbard modelljében is egy VFP van egységenként).
5. **Történetiség:** a poszt–személy hozzárendelés mettől-meddig dátumokkal tárolódik
   (a HR modulnak is kell majd).
6. **Szerkesztési jog:** első körben csak az ügyvezető (+ esetleg kijelölt admin)
   szerkeszti a táblát; mindenki más olvassa.

## 10. Nézet vs. szerkesztés (2026-08-19-én eldöntve)

**Egy nézet van, kettős védelemmel** (nem két külön felület):

1. **Jogosultság:** akinek nincs szerkesztési joga, annál a Szerkesztő mód kapcsoló
   meg sem jelenik — számára a tábla tisztán statikus.
2. **Szándékosság:** a jogosult felhasználónál is alapból nézet mód; a szerkesztés
   csak a Szerkesztő mód tudatos bekapcsolása után lehetséges, űrlapon + Mentés
   gombbal, törlés csak megerősítéssel. Véletlen kattintás nem módosít semmit.

Kiegészítő biztonsági hálók az éles rendszerben:
- **Változásnapló** (audit log): ki, mikor, mit módosított a táblán.
- **Visszavonás:** téves módosítás visszaállítható a napló alapján.
