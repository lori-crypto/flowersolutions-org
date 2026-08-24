# TERV — A webshop NEXUS-tükör moduljának átvétele (BI/statisztika alapja)

Állapot: felmérés kész, jóváhagyásra vár · 2026-08-24

## 1. Mit tud a webshopos modul (felmérés eredménye)

A webshop `admin/nexus` oldala + `/api/admin/nexus-mirror` route-ja:

1. **Tükör-nézetek**: NEXUS bizonylat-fejek hónaponként tárolva
   (`nexus_mirror_cache`): vevői/szállítói számlák, nyugták (chitante),
   banki tételek (banca), kifizetések (plati) + tételsorok igény szerint
   (`nexus_mirror_lines`). Szinkron: 10 percenként a futó+előző hónap,
   éjjel a teljes előzmény (2024-01-től).
2. **A LÉNYEG — „Heti rendelés vs számlázott" (compare)**: a webshopos
   **előrendeléseket** veti össze a NEXUS-ban ténylegesen **kiszámlázott**
   értékekkel, a cég saját „hét"-fogalma szerint:
   - a hét NEM naptári hét: a **szállítási nappal** (delivery_cycles) kezdődik
     és a következő szállítási nap előtti napig tart;
   - a rendelés a SAJÁT ciklusához számít (order_items × unit_price = orderRON);
   - a számlák a dátumuk szerinti vödörbe esnek (nettó + bruttó, deviza→RON
     árfolyammal, sztornó kiszűrve, id_document-dedup);
   - **ügyfél-párosítás**: `work_points.nexus_id_client` ↔ számla `id_client`
     (névre esés vissza);
   - kimenet: hetenként ügyfél-bontásban rendelt RON / számlázott nettó / bruttó.

## 2. Mi jön át az org rendszerbe és hogyan

Az org rendszerben **már megvan a jobbik fele**: a `sales_lines` (tételsoros,
hitelesített, éjjel frissülő valós eladás). Ami hiányzik:

### A) Webshop-előrendelések átvétele (új szinkron)
- Org API route: `/api/webshop-sync` — a webshop Supabase-éből (service-kulccsal,
  env: `WEBSHOP_SUPABASE_URL`, `WEBSHOP_SERVICE_KEY`) áthúzza:
  - `webshop_order_lines` táblába: rendelés-azonosító, szállítási ciklus dátuma,
    ügyfél (company + **nexus_id_client**), termék, mennyiség, egységár, érték,
    kategória, is_extra;
  - `webshop_cycles`: a szállítási napok (hét-határok a compare-hez).
- Ütem: éjszakai cron (a sales-sync után), + kézi frissítés gombról.
- Idempotens: ciklusonként csere.

### B) `sales_lines` kiegészítés: `id_client`
- A NEXUS-szinkron a fejből átveszi az `id_client`-et → megbízható
  ügyfél-párosítás a webshop-oldallal (nem név-egyeztetés).
- A történelmi (export) sorokban nincs id_client → ott név-alapú fallback.

### C) Összevetés (compare) az org-ban
- Ugyanaz a heti vödör-logika, de a számlázott oldal a saját `sales_lines`-ból
  (pontosabb: tételsoros, valós értékek, aviz-gyűjtők rendben).
- Kimenet mint a webshopban: hét → ügyfél → rendelt / számlázott nettó / bruttó
  (+ eltérés-oszlop és -jelzés).

### D) UI átköltöztetés
- A webshop `admin/nexus` oldal compare-nézete portolva az org **Statisztika**
  moduljába (HR/admin jog), a webshop BI oldal (szűrők + KPI + diagram-építő +
  adattábla + nyomtatás) mintáival együtt — EGY közös statisztika-felületen:
  - **Eladások** nézet (sales_lines): idősor/ügyfél/termékcsoport dimenziók
  - **Előrendelés vs számlázott** nézet (compare) — a heti táblázat
- A tükör többi nézete (banca/chitante/plati) a **Pénzügy modul** része lesz —
  akkor költözik, saját szinkronnal (incasari_plati).

## 3. Nyitott kérdések
1. A webshopos oldalak (bi, nexus/compare) a költözés után a webshopban
   megszűnnek-e azonnal, vagy egy ideig párhuzamosan élnek? (Javaslat: párhuzamos,
   amíg az org-verzió be nem bizonyítja magát; utána a webshopból kivezetés.)
2. Frissességi igény: az org sales-szinkron éjszakai — a compare-hez elég, vagy
   kell napközbeni (pl. óránkénti) futás is? (A webshop 10 percenként tükröz.)
3. A compare kezdőhete a webshopban 2026-07-22 (előtte tesztadat) — org-ban is
   ezt vesszük át.
