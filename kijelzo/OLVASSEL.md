# Fali kijelző — szabadságos tábla a print-szerver monitorán

A monitor a szervezési app egy külön, **csak olvasó** oldalát mutatja teljes képernyőn:

```
https://org.flowersolutions.ro/kijelzo/szabadsag?key=<kulcs>
```

- **Nincs belépés**: a hosszú kulcs a címben azonosít, ezért a monitor sosem „jelentkezik ki”,
  és ha valaki odaül a géphez, a kulccsal semmi máshoz nem fér hozzá (se pénztár, se kollégák).
- **Magától frissül** percenként. Ha nincs net, az utolsó adat marad kint, és jobb alul piros
  „nincs kapcsolat” jelzés látszik. Hajnali 4:10-kor újratölti magát (új verzió átvétele).
- A válaszban csak az van, ami a táblán látszik: rövidített név, nap, típus.

## Cím-paraméterek

| paraméter | jelentés |
|---|---|
| `key=…` | kötelező kulcs |
| `tabla=2` | melyik tábla (1 = Lerakat, 2 = Virágüzlet 1, 3 = Virágüzlet 2); alap: 1 |
| `valt=30` | 30 másodpercenként váltson a táblák között; alap: nem vált |
| `lang=ro` | román feliratok; alap: magyar |

## Telepítés a Linux print-szerverre

A `setup-kijelzo.KESZ.sh` már tartalmazza a kulcsos címet (ezért nincs a GitHubon).

```bash
scp setup-kijelzo.KESZ.sh lori@<SZERVER-IP>:~
ssh lori@<SZERVER-IP>
bash ~/setup-kijelzo.KESZ.sh
```

A szkript sudo nélkül fut. Megnézi, mi van a gépen (böngésző, asztali környezet), beállítja
az automatikus indulást, és **kiírja**, ha valamihez rendszergazdai parancs kell
(böngésző telepítése, automatikus bejelentkezés). Azokat le kell futtatni, utána `sudo reboot`.

- Napló: `~/kijelzo/kijelzo.log`
- Eltávolítás: `bash ~/setup-kijelzo.KESZ.sh --torol`
- Más tábla / váltogatás: írd át a `KIJELZO_URL` végét a szkriptben, és futtasd újra.

## A kulcs

A kulcs a Vercel `CRON_SECRET` értékéből képzett egyirányú lenyomat (a `lib/kioskKey.ts`
számolja), tehát **a `CRON_SECRET` cseréjével a kijelző kulcsa is megváltozik** — akkor a
telepítőt újra kell generálni. Ha külön kulcsot szeretnél, vegyél fel a Vercelen egy
`KIJELZO_SECRET` változót: onnantól abból képződik.
