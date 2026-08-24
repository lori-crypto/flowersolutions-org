# -*- coding: utf-8 -*-
"""NEXUS 'Statistica vanzari' CSV-k betöltése a sales_lines táblába.

Használat:  python scripts/load_sales.py
- Az adatok/ mappa összes *.csv fájlját beolvassa (CP1250).
- Valós értékek: real_net = val_puv - val_disc; a két aviz-os ügyfél
  aviz-sorain további -5% (számlázáskori kedvezmény).
- Idempotens: az érintett hónapokat (anluna) törli és újratölti.
"""
import csv, json, re, sys, urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
ADATOK = ROOT / "adatok"
ENV = ROOT / "org-app" / ".env.local"

AVIZ_5SZAZALEK_UGYFELEK = {
    "DECOR-MURES LC SRL",
    "FLORARIA CLAUDIA MURESENI S.R.L.",
}

env = {}
for line in open(ENV, encoding="utf-8-sig"):
    m = re.match(r"^([A-Z_]+)=(.*?)\s*$", line.strip())
    if m: env[m.group(1)] = m.group(2)
URL = env["NEXT_PUBLIC_SUPABASE_URL"]; KEY = env["SUPABASE_SERVICE_ROLE_KEY"]

def call(path, method="GET", body=None, prefer=None):
    req = urllib.request.Request(URL + path, method=method,
        data=json.dumps(body).encode() if body is not None else None)
    req.add_header("apikey", KEY); req.add_header("Authorization", "Bearer " + KEY)
    req.add_header("Content-Type", "application/json")
    if prefer: req.add_header("Prefer", prefer)
    with urllib.request.urlopen(req, timeout=180) as r:
        t = r.read().decode()
        return json.loads(t) if t else None

def num(s):
    try: return float((s or "0").replace(",", ""))
    except ValueError: return 0.0

def parse_file(path):
    rows_out = []
    with open(path, encoding="cp1250", newline="") as f:
        for r in csv.DictReader(f):
            tip = (r.get("tip_doc") or "").strip()
            if not tip: continue
            d = r["data_doc"].strip()          # DD/MM/YYYY
            iso = f"{d[6:10]}-{d[3:5]}-{d[0:2]}"
            v, t, disc = num(r["val_puv"]), num(r["val_tva"]), num(r["val_disc"])
            rate = (t / v) if v else 0.19
            aviz = tip != "Factura"
            cli = (r["nume_cli"] or "").strip()
            real_net = v - disc
            korr = False
            if aviz and cli in AVIZ_5SZAZALEK_UGYFELEK:
                real_net *= 0.95; korr = True
            rows_out.append({
                "source": "nexus_export", "tip_doc": tip,
                "seria": r["seria_doc"].strip(), "nr": r["nr_doc"].strip(),
                "data_doc": iso, "anluna": (r["anluna"] or "").strip() or iso[:4] + iso[5:7],
                "cont": (r["cont"] or "").strip() or None,
                "nume_cli": cli or None,
                "nume_gest": (r["nume_gest"] or "").strip() or None,
                "cod_ext": (r["cod_ext"] or "").strip() or None,
                "denumire": (r["denumire"] or "").strip() or None,
                "grupa": (r["nume_grupa"] or "").strip() or None,
                "clasa": (r["nume_clasa"] or "").strip() or None,
                "subclasa": (r["nume_subclasa"] or "").strip() or None,
                "um": (r["um"] or "").strip() or None,
                "cantitate": num(r["cantitate"]),
                "pu": num(r["pu"]), "puv": num(r["puv"]),
                "val_pu": num(r["val_pu"]), "val_puv": v, "val_disc": disc,
                "val_tva": t, "val_puv_tva": num(r["val_puv_tva"]),
                "real_net": round(real_net, 2),
                "real_gross": round(real_net * (1 + rate), 2),
                "aviz": aviz, "aviz_korr": korr,
            })
    return rows_out

def main():
    files = sorted(ADATOK.glob("*.csv"))
    if not files:
        print("Nincs CSV az adatok/ mappában."); return
    all_rows = []
    for f in files:
        rows = parse_file(f)
        print(f"{f.name}: {len(rows)} sor")
        all_rows += rows
    months = sorted({r["anluna"] for r in all_rows})
    print(f"Összesen {len(all_rows)} sor, hónapok: {', '.join(months)}")

    # idempotencia: érintett hónapok törlése
    call(f"/rest/v1/sales_lines?source=eq.nexus_export&anluna=in.({','.join(months)})",
         method="DELETE")
    # kötegelt feltöltés
    B = 1000
    for i in range(0, len(all_rows), B):
        call("/rest/v1/sales_lines", method="POST", body=all_rows[i:i+B],
             prefer="return=minimal")
        print(f"  feltöltve: {min(i+B, len(all_rows))}/{len(all_rows)}", flush=True)

    # ellenőrzés hónaponként (sorszám: pontos fejléc-számlálással)
    print("\n— Ellenőrzés (DB vs CSV) —")
    for m in months:
        req = urllib.request.Request(
            URL + f"/rest/v1/sales_lines?select=id&anluna=eq.{m}&source=eq.nexus_export",
            method="HEAD")
        req.add_header("apikey", KEY); req.add_header("Authorization", "Bearer " + KEY)
        req.add_header("Prefer", "count=exact"); req.add_header("Range", "0-0")
        with urllib.request.urlopen(req, timeout=60) as r:
            db_n = int(r.headers["Content-Range"].split("/")[1])
        src_n = sum(1 for r2 in all_rows if r2["anluna"] == m)
        src_v = round(sum(r2["real_net"] for r2 in all_rows if r2["anluna"] == m), 2)
        ok = "OK" if db_n == src_n else "ELTÉRÉS!"
        print(f"  {m}: CSV {src_n} sor (valós nettó {src_v:,.2f})  |  DB {db_n} sor  {ok}")

if __name__ == "__main__":
    main()
