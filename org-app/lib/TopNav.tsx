"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "./supabaseClient";
import { useI18n } from "./i18n";

// A bejelentkezett személy SAJÁT jogosultságai
export async function fetchMyCaps(): Promise<Set<string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return new Set();
  const { data: me } = await supabase.from("persons")
    .select("id").eq("user_id", session.user.id).maybeSingle();
  const { data } = await supabase.from("person_capabilities")
    .select("person_id, capability");
  return new Set((data ?? [])
    .filter(c => c.person_id === me?.id).map(c => c.capability));
}

export const capHas = (caps: Set<string> | null, c: string) =>
  !!caps && (caps.has(c) || caps.has("admin"));

// Hová kerüljön a belépő: az első modul, amihez joga van
export function routeForCaps(caps: Set<string>): string | null {
  const has = (c: string) => caps.has(c) || caps.has("admin");
  if (has("tabla")) return "/tabla";
  if (has("szabadsag")) return "/szabadsag";
  if (has("posztleiras")) return "/posztleirasok";
  if (has("penztar") || has("hr")) return "/penztar";
  return null;
}

// Tiltó képernyő fejléccel és menüvel — sosem zsákutca
export function NoAccessScreen({ active }: {
  active: "tabla" | "leave" | "people" | "desc" | "stat" | "penztar";
}) {
  const { t, lang, setLang } = useI18n();
  return (
    <>
      <header className="appbar">
        <span className="t">FS Org</span>
        <TopNav active={active} />
        <span className="sp" />
        <select className="lang-select" value={lang}
                onChange={e => setLang(e.target.value as "hu" | "ro")}>
          <option value="hu">HU — magyar</option>
          <option value="ro">RO — română</option>
        </select>
        <button className="lang-btn" onClick={() => supabase.auth.signOut()}>{t("sign_out")}</button>
      </header>
      <div className="center-msg">{t("no_access")}</div>
    </>
  );
}

// Jogosultság-tudatos felső menü: mindenki csak azokat a modulokat
// látja, amelyek pipálva vannak nála. (A tényleges védelem az
// adatbázisban van — ez a kényelmi réteg.)
export function TopNav({ active }: {
  active: "tabla" | "leave" | "people" | "desc" | "stat" | "penztar";
}) {
  const { t } = useI18n();
  const [caps, setCaps] = useState<Set<string> | null>(null);

  useEffect(() => {
    (async () => {
      try { setCaps(await fetchMyCaps()); }
      catch { setCaps(new Set()); }
    })();
  }, []);

  const has = (c: string) => capHas(caps, c);
  const hr = has("hr");
  const links = [
    { k: "tabla", href: "/tabla", label: t("nav_tabla"), show: has("tabla") },
    { k: "leave", href: "/szabadsag", label: t("nav_leave"), show: has("szabadsag") },
    { k: "people", href: "/kollegak", label: t("nav_people"), show: hr },
    { k: "desc", href: "/posztleirasok", label: t("nav_desc"), show: has("posztleiras") },
    { k: "stat", href: "/statisztika", label: t("nav_stat"), show: hr },
    { k: "penztar", href: "/penztar", label: t("nav_penztar"), show: hr || has("penztar") },
  ];
  return (
    <nav className="topnav">
      {links.filter(l => l.show || l.k === active).map(l => (
        <Link key={l.k} href={l.href}
              className={l.k === active ? "active" : undefined}>{l.label}</Link>
      ))}
    </nav>
  );
}
