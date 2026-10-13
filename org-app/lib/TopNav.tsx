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
