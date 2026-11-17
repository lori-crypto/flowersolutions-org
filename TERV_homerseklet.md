# Hőmérséklet-figyelő rendszer – terv (jóváhagyásra)

*Készült: 2026-11-17. Árak és készlet: optimusdigital.ro, aznapi állapot.*

## 1. Hardver

### Mérési pont felépítése

Egy mérési pont: **ESP32 panel + szonda + USB-C táp + doboz**.

**Hűtőkamra:** az ESP32 a kamrán **kívül** kerül a falra, és csak a vízálló szonda megy be, a kábelével az ajtótömítés mellett vagy egy meglévő kábelátvezetőn át.
- Ok: a hűtőkamra fala fémlemezes szendvicspanel, ami gyakorlatilag elnyeli a Wi-Fi-jelet. Ha az elektronika kint van, a Wi-Fi-vel nincs gond, és nem éri pára vagy hideg sem.
- A szondát egy kis üvegbe tesszük, víz és fagyálló (glikol) keverékébe ("pufferpalack"). Így a szonda a **virágok hőmérsékletét** követi, nem a levegőét. Ajtónyitáskor a levegő pár perc alatt felmelegszik, a palack nem. Ez az iparági bevett megoldás az ajtónyitásos téves riasztások ellen.

**Épület vagy raktár:** az ESP32 és egy hőmérséklet-páratartalom érzékelő egy szellőző dobozban.

**Egy ESP32 több szondát is kezel.** Ha két hűtőkamra egymás mellett van, egy panel elég nekik, és a második pont csak egy újabb szonda (kb. 10 lei).

### Szondaválasztás

A klasszikus vízálló **DS18B20** szonda (8,49 lei) **jelenleg nincs készleten** az Optimusnál. Ezért ezt javaslom:
- **Vízálló NTC 10k termisztor, 2 m kábellel** (9,99 lei, 43 db készleten). Pontosság: egy jeges vizes kalibráció után ±0,3–0,5 °C a 0–10 °C-os tartományban, ez a riasztáshoz bőven elég. A kalibrációt telepítéskor egyszer elvégzem, kb. 5 perc szondánként.
- Ha a DS18B20 újra kapható lesz, átállhatunk rá: digitális, nem kell kalibrálni. A rendszer mindkettőt kezelni fogja.

### Bevásárlólista (Optimus Digital)

| Tétel | Ár | Készlet | Mire kell |
|---|---|---|---|
| [Plusivo ESP32 fejlesztőpanel, USB-C](https://www.optimusdigital.ro/ro/placi-cu-esp32/12933-placa-de-dezvoltare-plusivo-wireless-compatibila-cu-esp32-si-ble.html) | 29,99 lei | 569 db | mérési pontonként 1 |
| [Plusivo 5 V / 3 A USB-C táp](https://www.optimusdigital.ro/ro/alimentatoare/10904-alimentator-plusivo-de-5-v-3-a-cu-mufa-usb-tip-c-pentru-rasbperry-pi-4.html) | 29,98 lei | 775 db | ESP32-nként 1 (régi USB-C telefontöltő is jó) |
| [Vízálló NTC 10k szonda, 2 m](https://www.optimusdigital.ro/ro/senzori-senzori-de-temperatura/8206-termistor-ntc-de-10k-rezistent-la-apa-cu-cablu-de-2-m.html) | 9,99 lei | 43 db | hűtőkamránként 1 |
| [Vízálló NTC 10k szonda, 1 m](https://www.optimusdigital.ro/ro/senzori-senzori-de-temperatura/8204-termistor-ntc-de-10k-rezistent-la-apa-cu-cablu-de-1-m.html) | 5,27 lei | 2074 db | ha a panel közvetlenül a kamra mellett van |
| [GY-SHT21 hőmérséklet + páratartalom modul](https://www.optimusdigital.ro/ro/senzori-senzori-de-temperatura/3315-modul-senzor-de-temperatura-i-umiditate-cu-precizie-inalta-gy-sht21.html) | 34,99 lei | 8 db | épületenként 1 |
| *(alternatíva)* [DHT21/AM2301, saját házban](https://www.optimusdigital.ro/ro/senzori-senzori-de-temperatura/2956-senzor-de-temperatura-dht21am2301.html) | 49,99 lei | 146 db | ha 8-nál több épületpont kell |
| [Vízálló műanyag doboz, 123×68×50 mm](https://www.optimusdigital.ro/ro/carcase/5719-carcasa-alba-din-plastic-rezistenta-la-apa-123x68x50-mm.html) | 14,99 lei | 93 db | hűtőkamrás pontokhoz |
| [Műanyag doboz, 125×80×32 mm](https://www.optimusdigital.ro/ro/carcase/5715-carcasa-alba-din-plastic-125x80x32-mm.html) | 9,99 lei | 21 db | épületpontokhoz (szellőzőlyukakat fúrunk rá) |
| [Ellenálláskészlet (110 db)](https://www.optimusdigital.ro/ro/componente-electronice-rezistoare/13607-set-rezistoare-110-rezistoare.html) | 7,00 lei | 421 db | 1 készlet az egészhez (az NTC-khez 10k kell) |

Nem javasolt, mert nincs készleten vagy túl kevés van: DS18B20 vízálló szonda (0 db), SHT31 (0 db), AHT10 (2 db).
Apró szerelési anyag (vezeték, sorkapocs, kábelkötegelő) kb. 10 lei; ezt a rendelés véglegesítésekor teszem a listához.

## 2. Architektúra

```
ESP32 (60 mp-enként mér)  --HTTPS-->  Supabase (adatbázis + időzített ellenőrzés)
                                          |                 |
                                          v                 v
                                    PWA (Next.js,      Telegram-bot
                                    Vercel): élő +     (riasztás, "Láttam" gomb,
                                    grafikonok         /allapot parancs)
```

**ESP32 program:**
- Percenként mér, és egy hívással elküldi az összes szondája adatát a Supabase-nek, minden eszköz a saját titkos kulcsával.
- Ha nincs internet, a méréseket eltárolja (órákra elegendő helyen), és később pótolja, így a grafikonon nem lesz lyuk.
- Wi-Fi beállítás telefonról (a panel saját beállító hálózatot nyit), és a programot távolról is frissíthetjük (OTA).

**Supabase:**
- Táblák: `telephelyek`, `erzekelok` (név, típus, küszöbértékek, késleltetés), `meresek`, `riasztasok`, `telegram_cimzettek`.
- A nyers percenkénti adatot 90 napig tartjuk meg, utána óránkénti min/átlag/max formában örökre. Így az ingyenes keret évekig elég.
- Az adat közvetlenül adatbázis-függvényen keresztül érkezik, nem Edge Functionön át, így az ingyenes hívási keret sem fogy el.

**Riasztási logika** (az adatbázis percenként maga ellenőrzi, a pg_cron ütemezővel):

| Riasztás | Mikor szól | Alapérték hűtőkamrára |
|---|---|---|
| Túl meleg | ha a határ felett van **folyamatosan X percig** | > 8 °C legalább 20 percig |
| Nagyon meleg | ugyanez, rövidebb várakozással | > 12 °C legalább 5 percig |
| Túl hideg (fagyveszély) | ha a határ alatt van X percig | < 0,5 °C legalább 15 percig |
| Érzékelő elhallgatott | ha nem jön adat | 10 perc |
| **Telephely kiesett** | ha **minden** érzékelő egyszerre hallgat el | 5 perc → "Áramszünet vagy internetkimaradás: X telephely" |

- Ajtónyitás ellen kettős védelem van: a pufferpalack és a késleltetés. A határértékek érzékelőnként állíthatók a PWA-ban.
- A riasztás csak egyszer szól, nem percenként. Ha senki nem nyomja meg a „Láttam” gombot, 30 percenként emlékeztet.
- Amikor a hőmérséklet visszaáll, jön egy „Rendben” üzenet. A visszaálláshoz a határ alatt 0,5 °C-kal, 5 percig kell lennie, így nem villog ki-be.
- Egy korlát: áramszünetkor a router is leáll, ezért a rendszer csak annyit lát, hogy a telephely elhallgatott, azt nem, hogy miért. Ha szét akarod választani az áramszünetet és a netkimaradást, a 2. fázisban jöhet egy kis szünetmentes táp a routerre és egy akkus „őrszem” ESP32.

**Telegram-bot:** a BotFatherrel hozzuk létre, és a riasztások egy „Hűtő riasztások” csoportba mennek. Parancsok: `/allapot` (minden érzékelő aktuális értéke) és a „Láttam” gomb. A gomb a PWA-n keresztül működik (Vercel API-útvonal).

**PWA (Next.js + Vercel + Supabase Auth):**
- **Áttekintő:** telephelyenként kártyák az érzékelőkkel. Mindegyiken az aktuális hőmérséklet, a színe zöld/sárga/piros, és az, hogy mikor jött utoljára adat. Élőben frissül (Supabase Realtime).
- **Érzékelő oldala:** grafikon a határértékvonalakkal; nézetek: 24 óra, 7 nap, 30 nap, egyedi időszak; CSV-export.
- **Riasztásnapló:** ki mikor nyugtázta, mennyi ideig tartott.
- **Beállítások:** érzékelők elnevezése, határértékek, késleltetés, Telegram-címzettek.
- Telefonra telepíthető, kezdőképernyő-ikonnal.

**Futási költség:** 0 lei/hó (Supabase ingyenes keret, Vercel, Telegram).

## 3. Költségbecslés

| Mérési pont | Összetétel | Ár |
|---|---|---|
| **Hűtőkamra, saját ESP32-vel** | ESP32 + táp + NTC 2 m + vízálló doboz | **≈ 85 lei** |
| Újabb hűtőkamra ugyanarról az ESP32-ről | +1 NTC szonda | **≈ 5–10 lei** |
| **Épület vagy raktár** | ESP32 + táp + SHT21 + doboz | **≈ 105 lei** |
| Ha van régi USB-C telefontöltő | a táp kimarad | −30 lei pontonként |

### Kiosztás: 8 mérési pont, 6 panel

| Panel | Mérési pontok | Érzékelők | Doboz |
|---|---|---|---|
| 1 | Hűtőkamra A + Hűtőkamra B (egymásba nyílnak) | 2 × NTC szonda | vízálló |
| 2 | Virágos hűtő, 1. bolt | 1 × DS18B20 | vízálló |
| 3 | Virágos hűtő, 2. bolt | 1 × DS18B20 | vízálló |
| 4 | Iroda | 1 × DS18B20 | sima |
| 5 | Kisebb raktár | 1 × DS18B20 | sima |

**Végleges, 5 panel.**
- Az 1. panel: Hűtőkamra A + B + C + Raktár, **4 × DS18B20**, vízálló dobozban. Mind a 4 szonda külön csatlakozón van, és szükség szerint UTP-kábellel hosszabbítjuk.
- A fenti táblázat 1. sora („Hűtőkamra A + B, 2 × NTC”) elavult. A panel első kamra melletti elhelyezéséről szóló megjegyzés is elavult.

- **Panel 1:** a panel az első kamra mellé, kívülre kerül. A belső kamra szondájának kábelét sima kéteres vezetékkel 3–5 méterre hosszabbítjuk; ez az NTC pontosságát nem rontja.
- **Panel 2:** a panel a raktár felőli falon van. A szonda bemegy a C kamrába, az SHT21 a doboz mellett méri a raktár levegőjét.
- **Panel 3 és 4:** a nyitott virágos hűtőknél a pufferpalack különösen fontos, mert a nyitott eleje miatt a levegő folyamatosan ingadozik. Ezeknél hosszabb a késleltetés (30 perc).

**Áram és kábelezés (eldöntve):**
- A panel mindig a konnektor mellé kerül. Ha a mérőpont messzebb van, a szonda kábelét hosszabbítjuk meg.
- A hosszabbítás sodrott érpárú kábellel (UTP) történik, szondánként 20 méterig.
- Minden szonda a panel saját csatlakozójára kerül, így egy hibás szonda nem viszi el a többit. Egy panel 6–8 szondát kezel.

### Telephelyek

| Telephely | Panelek | Ha elhallgat |
|---|---|---|
| Központ | 1, 4, 5 | ha **mind a 3** egyszerre elhallgat: „Áramszünet vagy internetkimaradás a Központban”; ha csak 1: „Eszközhiba: Panel X” |
| 1. bolt | 2 | „1. bolt: nincs adat (áramszünet, internet vagy eszközhiba)” |
| 2. bolt | 3 | „2. bolt: nincs adat (áramszünet, internet vagy eszközhiba)” |

- A boltokban csak egy-egy panel van, így ott a rendszer nem tudja megmondani, mi okozta a kiesést. Az üzenet ezért mindhárom lehetőséget megnevezi.
- A Központ áramszünetét akkor is jelzi a rendszer, ha a printszerver is leáll, mert az ellenőrzés a felhőben fut.

### Végleges bevásárlólista (1 ESP32 és 2 szonda tartalékkal)

**Frissítve: vegyes rendelés.** A szondák a drot.ro-ról jönnek, a többi az Optimusról. A drot.ro-n a vízálló DS18B20 is kapható, és olcsóbb.

**Optimus Digital** (panelek, tápok, dobozok)

| Tétel | Db | Egységár | Összesen |
|---|---|---|---|
| Plusivo ESP32 USB-C (5 + 1 tartalék) | 6 | 29,99 | 179,94 |
| Plusivo 5 V / 3 A USB-C táp | 5 | 29,98 | 149,90 |
| Vízálló doboz 123×68×50 | 3 | 14,99 | 44,97 |
| Sima doboz 125×80×32 | 2 | 9,99 | 19,98 |
| **Részösszeg** | | | **394,79 lei** |

**drot.ro** (érzékelők; 2–7 munkanap, Packeta 17,29 lei, FAN Courier 27,45 lei)

| Tétel | Db | Egységár | Összesen |
|---|---|---|---|
| Vízálló DS18B20 szonda, 2 m (kamrák, virágos hűtők + 2 tartalék) | 7 | 13,06 | 91,42 |
| Vízálló DS18B20 szonda, 1 m (iroda, raktár, kisebb raktár) | 3 | 10,77 | 32,31 |
| 4,7 kΩ ellenállás (a DS18B20-hoz) | 6 | ~0,23 | ~1,38 |
| **Részösszeg** | | | **≈ 125,11 lei + szállítás** |

**Frissítve: mindenhol DS18B20 lesz, páratartalmat nem mérünk.**
- **Alkatrészek összesen: ≈ 520 lei** (394,79 + 125,11), plusz a két szállítás és a hosszabbításhoz szükséges UTP-kábel.

Ugyanannyi pénzért jobb szonda: a DS18B20-at nem kell kalibrálni, és a két egymásba nyíló kamra szondája egy vezetékre fűzhető.

(Az ESP32 panel a drot.ro-n drágább: 40 lei, micro USB. Ezért az Optimusról vesszük.)

Ehhez jön kb. 15 lei apró anyag (hosszabbító vezeték, sorkapocs, kábelkötegelő) és a szállítás. Minden használható régi USB-C telefontöltő 30 lejjel csökkenti az összeget.

**Pontonként ez kb. 81 lei.**

Javaslat:
- Mindent egyszerre rendelünk meg.
- A próbaüzem a két legnehezebb helyen indul: Panel 1 (két kamra, hosszabbított szonda) és Panel 3 (nyitott hűtő).
- Ha 2 hétig nincs téves riasztás, jön a többi 4 panel.

### Alap határértékek (a PWA-ban módosíthatók)

| Hely | Riasztás, ha meleg | Riasztás, ha hideg | Késleltetés |
|---|---|---|---|
| Hűtőkamra | > 8 °C | < 0,5 °C | 20 perc |
| Virágos hűtő (nyitott) | > 10 °C | < 1 °C | 30 perc |
| Raktár, kisebb raktár | > 30 °C | < 3 °C | 30 perc |
| Iroda | csak naplózás | < 10 °C (fűtéshiba) | 60 perc |

## 4. Megbízhatósági kiegészítések

- **Napi életjel:** reggel 8-kor a bot rövid összefoglalót küld. Ha nem jön, maga a rendszer áll.
- **Második ellenőr:** a helyi Linuxos printszerver (192.168.191.249) percenként megnézi, jönnek-e adatok. Ha nem, ő is küld Telegram-üzenetet.
- Az érzékelők külön vendég- vagy IoT Wi-Fi-hálózaton legyenek.
- A próbaüzem alatt egy egyszerű min/max hőmérő is legyen mellettük összehasonlításnak.

## Döntések, amikhez a te válaszod kell

1. ~~Telephelyek~~: eldöntve. 3 telephely: a Központ (hűtőkamrák, raktárak, iroda) és a két bolt, külön címen. Telepítéskor ellenőrizni kell, hogy mindenhol van-e Wi-Fi és konnektor.
2. **Kamránként mi a célhőmérséklet?** (Az alapérték 2–8 °C, a riasztás 8 °C felett, illetve 0,5 °C alatt.)
3. ~~Supabase~~: eldöntve, **a Managment rendszerbe épül**.
   - Közös a belépés és a felhasználók.
   - A hőmérséklet-táblák külön csoportba kerülnek (pl. `homerseklet_` előtaggal), így nem keverednek a meglévőkkel.
   - A PWA a Managment rendszer új menüpontja lesz, telefonra külön is telepíthető.
   - A megvalósítás előtt átnézem a projekt szerkezetét.
4. ~~Telegram~~: eldöntve.
   - Egy „Hűtő riasztások” csoport készül, kezdetben csak Lori van benne.
   - Később 2 kolléga csatlakozik egy meghívólinkkel, amint lesz Telegramjuk. Ehhez semmit sem kell átállítani, mert a bot a csoportba küld.
5. ~~Szonda~~: eldöntve. **Vízálló DS18B20, 2 m**, a drot.ro-ról. Az épületekbe HTU21D kerül, szintén a drot.ro-ról. A panelek, a tápok és a dobozok az Optimusról jönnek. (Az NTC-ről szóló rész a fenti 1. fejezetben már elavult.)
