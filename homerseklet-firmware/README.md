# Hőmérséklet-figyelő panel (ESP32 + DS18B20)

Terv és döntések: a Managment rendszer `sql/38_homerseklet.sql` fejléce és a
„Hőmérséklet” menüpont.

## Bekötés

Minden szonda saját lábra megy, és minden lábhoz kell egy 4,7 kΩ-os ellenállás
az adatvezeték és a 3V3 közé.

| DS18B20 vezeték | ESP32 |
|---|---|
| piros (táp) | 3V3 |
| fekete (föld) | GND |
| sárga (adat) | GPIO 4, 16, 17, 18, 19, 21, 22 vagy 23 — szondánként egy |
| 4,7 kΩ | a sárga és a 3V3 közé |

- Hosszabbítás: UTP-kábellel, szondánként 20 m-ig. Egy érpár legyen az adat + föld.
- Hűtőkamrában a szonda kis üvegbe kerül, víz és fagyálló keverékébe (pufferpalack).
  Irodában és raktárban a levegőben lóg, a panel dobozától legalább 10 cm-re.

## Feltöltés (egyszer, gépről)

1. Arduino IDE 2 → Boards Manager: **esp32 by Espressif** (3.x).
2. Library Manager: **OneWire**, **DallasTemperature**, **WiFiManager** (tzapu),
   **ArduinoJson** (7.x).
3. `config.example.h` → másold `config.h` néven, töltsd ki.
4. Alaplap: **ESP32 Dev Module**, port kiválasztása, Feltöltés.

Utána frissíteni ugyanazon a Wi-Fin hálózaton át is lehet (Arduino IDE → port:
`fs-homero-xxxx`; jelszó: az eszközkulcs első 12 karaktere).

## Beállítás (panelenként, telefonról)

1. A Managment rendszerben: Hőmérséklet → Beállítások → telephely → **Panel
   felvétele**. A megjelenő 64 karakteres kulcsot másold ki.
2. Áramra dugod a panelt → nyit egy **FS-Homero-xxxx** Wi-Fit. Csatlakozz rá
   telefonnal → megnyílik a beállító oldal (ha nem, írd be: 192.168.4.1).
3. Válaszd ki a bolt/raktár Wi-Fijét, add meg a jelszót és az eszközkulcsot → Save.
4. 1–2 percen belül a szondák megjelennek a Beállításokban „ÚJ — nevezd el”
   címkével. Nevezd el őket, és válaszd ki a típust (ez betölti a határértékeket).
   Amíg nincs elnevezve, a szonda nem riaszt.

Melyik szonda melyik? Fogd meg egyiket a kezedben 1 percig: amelyik melegszik,
az az. (Vagy egyenként dugd be őket.)

Újrabeállítás (másik Wi-Fi, új kulcs): a **BOOT** gombot 5 mp-ig nyomva tartva
újra megnyílik a beállító Wi-Fi.

## Kék LED jelzései (percenként, méréskor)

| Jelzés | Jelentés |
|---|---|
| 1 rövid villanás | rendben, elküldve |
| 3 lassú villanás | nincs Wi-Fi (a mérés megy tovább, később pótolja) |
| 5 gyors villanás | rossz vagy letiltott eszközkulcs |
