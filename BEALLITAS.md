# Beállítási útmutató (egyszeri teendők)

Ezeket csak te tudod megcsinálni, mert fiók-hozzáférés kell hozzájuk.
Sorrendben, kb. 20 perc összesen. Ha elakadsz, szólj és segítek.

## 1. Supabase projekt (adatbázis + belépés)

1. https://supabase.com → bejelentkezés → **New project**
   - Name: `fs-org` (vagy tetszőleges)
   - Region: **EU (Frankfurt)** — közel van, GDPR-barát
   - Database password: generáltasd és mentsd el (ritkán kell)
2. Létrehozás után 1–3 perc a felépülés (addig a menük inaktívak — frissíts).
   A kulcsok: felül a zöld **Connect** gomb, vagy **Settings → API Keys**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - **Publishable key** (`sb_publishable_...`, régebbi nevén `anon public`)
     → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **Secret key** (`sb_secret_...`, régebbi nevén `service_role`)
     → `SUPABASE_SERVICE_ROLE_KEY` (TITOK — csak szerverre)
3. **SQL Editor** → futtasd sorrendben a `sql/` mappa fájljait:
   - `01_alap.sql`
   - `02_orgboard.sql`
   - `03_orgboard_seed.sql`
4. **Authentication → Users → Add user**: a saját email-címed + jelszó
   (ezzel lépsz majd be az appba).
5. SQL Editorban futtasd a `03_orgboard_seed.sql` végén lévő kikommentezett
   "ELSŐ ADMIN" blokkot (a saját email-címeddel) — ettől leszel admin.

## 2. Helyi futtatás (fejlesztés/kipróbálás)

1. Az `org-app/` mappában hozz létre `.env.local` fájlt a `.env.local.example`
   alapján, és írd bele az 1.2-es értékeket.
2. Futtatás:
   ```
   cd org-app
   npm install
   npm run dev
   ```
3. Böngészőben: http://localhost:3000 → belépés az 1.4-es email+jelszóval.

## 3. GitHub repo

1. https://github.com/new → név pl. `fs-org` → **Private** → Create.
2. A projekt gyökeréből (Managment rendszer mappa):
   ```
   git init
   git add -A
   git commit -m "Kezdeti váz: szervezési tábla modul"
   git branch -M main
   git remote add origin https://github.com/<felhasznalod>/fs-org.git
   git push -u origin main
   ```

## 4. Vercel (hosting + org.flowersolutions.ro)

1. https://vercel.com → **Add New → Project** → importáld a GitHub repót.
2. **Root Directory**: `org-app` (fontos — az app almappában van!)
3. **Environment Variables** (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy → kapsz egy `*.vercel.app` címet, ellenőrizd, hogy él.
5. **Settings → Domains** → add hozzá: `org.flowersolutions.ro`
   → a DNS-ben (ahol a flowersolutions.ro-t kezeled) vegyél fel egy
   **CNAME** rekordot: `org` → `cname.vercel-dns.com`

## 5. Resend (email — később is ráér)

Majd akkor kell, amikor a meghívó emailes flow-t élesítjük:
`RESEND_API_KEY`, `RESEND_FROM` env-változók a Vercelen.
