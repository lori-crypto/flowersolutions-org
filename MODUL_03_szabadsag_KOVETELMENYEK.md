# Modul 3 — Szabadságos tábla (követelmények és terv)

Állapot: **tervezet, jóváhagyásra vár**
Utolsó frissítés: 2026-08-19
Indulás: **2027-től** (az idei évet a falitábla viszi végig)

## 1. Cél

A falon lévő éves tervező (Bi-Office Annual Planner) digitális utódja:
- a kollégák **maguk írják be** a szabadságukat — telefonról, pár koppintással
- a tábla **mindenkinek átlátható** (mint a fali változat)
- a **szabályokat a rendszer tartatja be** (nem utólag derül ki az ütközés)

## 2. Amit a falitábláról átveszünk (bevált minta)

A jelenlegi színmagyarázat 1:1 megfelelője — a megszokott színekkel:

| Bejegyzés-típus | Szín (a tábláról) | Megjegyzés |
|---|---|---|
| Betervezett szabadság | kék | az alap eset — ez fogyasztja a keretet |
| Kivett állami ünnepnap | zöld | ledolgozott ünnepnap később kivéve |
| Hétvégi raktár-ügyelet | piros (név) | nem szabadság — beosztás jellegű bejegyzés |
| Betegszabadság | (a táblán jelölt) | utólag rögzíthető; nem fogyasztja a keretet |
| Zárolt nap (piros vonal) | piros sáv | ezekre a napokra NEM lehet szabadságot beírni |

A típuslista **bővíthető** (admin felületen: név HU/RO, szín, fogyasztja-e a
keretet, ki rögzítheti).

Külső minták (dokumentálódás): a bevált szabadság-kezelők (Timetastic-féle
„wall chart", LeaveBoard, absence.io stb.) közös elemei — színkódolt közös
naptár, mobil önkiszolgáló igénylés, ütközés-jelzés, keret-számláló, zárolt
időszakok — pontosan a mi igényünkkel fedésben vannak; a terv ezekre a
mintákra épül, de a saját (szigorúbb, azonnal tiltó) szabályainkkal.

## 3. Szabályok (a lényeg!)

A szabályok **konfigurálhatók** (nem beégetettek), mert „lehet még más szabály
is". Induló készlet:

1. **Zárolt időszak:** admin/vezető által kijelölt napokra-időszakokra (a táblán
   a piros vonalak — pl. csúcsszezon) a kolléga nem írhat be szabadságot.
   A zárolás lehet cég-szintű vagy (később) osztály-szintű.
2. **Egyidejűségi korlát:** egy napra legfeljebb N kolléga írhat be szabadságot
   (indulásra: 2); a következő próbálkozást a rendszer elutasítja, és mutatja,
   kik foglalták már le. **A korlát táblánként (egységenként) állítható** —
   pl. Lerakat: 1, virágüzletek: 2.
3. *(előkészítve, kapcsolható)* minimum előrejelzési idő (pl. legkésőbb X
   nappal előtte), maximum egybefüggő hossz, éves keret túllépésének tiltása.

Szabály-felülbírálás: **csak admin/HR** teheti meg (pl. kivételes eset), naplózva.

## 4. Működés

### 4.1 Beírás (kolléga, telefonról)

1. Megnyitja a Szabadság modult → naptáron kijelöli a napot/időszakot
2. Típus kiválasztása (alapértelmezett: betervezett szabadság)
3. A rendszer **azonnal ellenőrzi a szabályokat**:
   - zárolt nap? → tiltás, magyarázattal
   - betelt a napi korlát? → tiltás, látszik, ki van már beírva
4. Mentés → azonnal megjelenik mindenkinek

Törlés/módosítás: a saját jövőbeli bejegyzését módosíthatja; múltbelit csak HR.

### 4.2 Kinek mit szabad

- **Kolléga:** saját bejegyzés beírás/módosítás (szabályokon belül); a teljes
  tábla megtekintése
- **HR (`hr` képesség):** bárki bejegyzésének kezelése, betegszabadság rögzítése,
  múltbeli javítás, szabály-felülbírálás
- **Admin/ügyvezető:** minden + zárolt időszakok és szabályok beállítása +
  keretek megadása
- Hétvégi ügyelet: vezető/HR rögzíti (beosztás), nem önkiszolgáló — *nyitott kérdés*

### 4.3 Keretek (opcionális, de ajánlott)

- Személyenként évi keret (nap); a felület mutatja: **összes / felhasznált /
  hátralévő**
- A betervezett szabadság fogyasztja, a betegszabadság és az ünnepnap-kivét
  külön számolódik
- Román állami ünnepnapok évente előtöltve (admin szerkesztheti)

## 5. UI-koncepció (mobil az első!)

- **Év-áttekintő** (a falitábla öröksége): 12 hónap kompakt rácsban, a napok
  színkódolva (foglaltság-jelzéssel: üres / 1 fő / tele / zárolt). Desktopon ez
  a fali tábla 1:1 élménye; mobilon görgethető hónap-kártyák.
- **Hónap-nézet** (mobilon az alap): függőleges naplista; minden napnál a
  beírt nevek színes címkéi; zárolt napok piros sávval; hétvégék elkülönítve.
- **Beírás:** koppintás a napra (vagy „+ Szabadság" gomb) → időszak-választó →
  típus → azonnali szabály-visszajelzés → mentés. 3 koppintás legyen az alapeset.
- **Saját nézet:** „Szabadságaim" — a saját bejegyzések listája + keret-számláló.
- **Nap-részletek:** koppintásra alsó lap (bottom sheet): ki van beírva, milyen
  típussal; innen közvetlen beírás, ha szabad a nap.
- Szűrés osztályra (a szervezési táblából) — nagy létszámnál átláthatóbb.

## 6. Adatmodell (vázlat)

```
leave_boards     — tábla/egység: név_hu/ro (Lerakat, Virágüzlet 1, Virágüzlet 2…),
                   sorrend; bővíthető
board_members    — person_id ↔ board_id (alap-tábla; vezető/HR több táblát láthat)
leave_types      — kód, név_hu/ro, szín, keretet_fogyaszt (bool),
                   önkiszolgáló (bool), sorrend
leave_entries    — board_id, person_id, dátum, napszak (egész | de | du),
                   type, megjegyzés, ki rögzítette, mikor; törlés = sor törlés + audit
duty_swaps       — két ügyeleti bejegyzés cseréje: kezdeményező, elfogadó,
                   státusz (függő/elfogadva/elutasítva), időbélyegek
blackout_periods — board_id, mettől-meddig, indoklás, ki adta
leave_rules      — board_id, kulcs (pl. 'max_concurrent'), érték
leave_quotas     — person_id, év, keret (nap, fél napos pontosság)
holidays         — év, dátum, név_hu/ro (RO ünnepnapok)
```

- Az ellenőrzések **adatbázis-szinten** (RPC + constraint) is érvényesülnek,
  nem csak a felületen — így versenyhelyzetben (ketten egyszerre írnak be)
  sem csúszhat át szabálysértés.
- Minden művelet az `audit_log`-ba kerül (megvan az alap).
- Kapcsolat: `persons` (megvan), osztály-hatókör a szervezési táblából.

## 7. Ütemezés (javaslat)

1. **1. ütem (2027 előtt kell):** típusok + beírás/törlés szabály-ellenőrzéssel
   (zárolt napok, napi korlát) + hónap- és év-nézet + saját nézet
2. **2. ütem:** keretek + ünnepnap-előtöltés + HR-funkciók (betegszabadság,
   javítás, felülbírálás) + osztály-szűrés
3. **3. ütem:** hétvégi ügyelet-beosztás, értesítések (pl. vezetőnek összesítő),
   export (nyomtatható éves tábla)

## 8. Eldöntött kérdések (2026-08-19)

1. **Nincs jóváhagyási kör** — önkiszolgáló modell, a szabályok szűrnek.
2. **A napi létszám-korlát állítható** — táblánként (és így egységenként) más-más
   érték adható meg.
3. **Fél nap is beírható** (délelőtt/délután) — a keretből 0,5 napot fogyaszt.
4. **A hétvégi ügyeletet a vezető osztja be**, de a kollégák időnként cserélnek →
   kell **csere-funkció**: a kolléga cserét kezdeményez egy társával, a másik fél
   elfogadja, a rendszer átírja (naplózva); a vezető közvetlenül is átírhatja.
5. **Keret-számláló már az 1. ütemben kell** (összes / felhasznált / hátralévő,
   fél napos pontossággal).
6. **Több különálló tábla:** a **Lerakatnak** saját táblája van, és a **két
   virágüzletnek is külön-külön** (nem egyben) — összesen 3 tábla indulásra,
   bővíthető. Minden táblának saját szabályai (napi korlát, zárolások) és saját
   nézetei vannak; a kolléga a saját egysége táblájába ír. Felül egyszerű
   tábla-váltó azoknak, akik többet látnak (vezetők, HR, admin).
