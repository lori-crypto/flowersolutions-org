"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";
import { loadPostList, PostMeta, DescStatus } from "@/lib/postdesc";

type ListData = Awaited<ReturnType<typeof loadPostList>>;

export default function PosztleirasokPage() {
  const { t, lang, setLang, pick } = useI18n();
  const router = useRouter();
  const [data, setData] = useState<ListData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      try { setData(await loadPostList()); }
      catch (e) { setErr((e as Error).message); }
    })();
  }, [router]);

  if (err) return <div className="center-msg">Hiba: {err}</div>;
  if (!data) return <div className="center-msg">{t("loading")}</div>;

  const descByPost = new Map<string, { status: DescStatus; version: number }[]>();
  for (const d of data.descs) {
    const arr = descByPost.get(d.post_id) ?? []; arr.push(d); descByPost.set(d.post_id, arr);
  }

  const place = (p: PostMeta) => {
    if (p.department) {
      const dv = p.department.division;
      return (dv ? pick(dv.name_hu, dv.name_ro) + " · " : "") + pick(p.department.name_hu, p.department.name_ro);
    }
    if (p.division) return pick(p.division.name_hu, p.division.name_ro);
    if (p.group) return pick(p.group.label_hu, p.group.label_ro);
    return t("pd_org_level");
  };

  // szerkesztő mindent lát; kolléga a saját posztjait + amihez olvasási joga van
  const visible = data.posts.filter(p =>
    data.canEdit || data.myPostIds.has(p.id) || descByPost.has(p.id));

  const badge = (postId: string) => {
    const list = descByPost.get(postId) ?? [];
    const active = list.find(d => d.status === "ervenyes");
    const draft = list.find(d => d.status === "vazlat");
    if (active) return <span className="acct-tag ok">v{active.version}</span>;
    if (draft) return <span className="acct-tag">{t("pd_draft")}</span>;
    return <span className="acct-tag">{t("pd_missing")}</span>;
  };

  return (
    <>
      <header className="appbar">
        <span className="t">{t("pd_title")}</span>
        <nav className="topnav">
          <Link href="/tabla">{t("nav_tabla")}</Link>
          <Link href="/szabadsag">{t("nav_leave")}</Link>
          <Link href="/kollegak">{t("nav_people")}</Link>
          <Link href="/posztleirasok" className="active">{t("nav_desc")}</Link>
        </nav>
        <span className="sp" />
        <button className="lang-btn" onClick={() => window.location.reload()}>↻</button>
        <select className="lang-select" value={lang}
                onChange={e => setLang(e.target.value as "hu" | "ro")}>
          <option value="hu">HU — magyar</option>
          <option value="ro">RO — română</option>
        </select>
        <button className="lang-btn" onClick={() => supabase.auth.signOut()}>{t("sign_out")}</button>
      </header>

      <div className="people-wrap">
        {visible.length === 0 && <div className="center-msg">{t("pd_none_visible")}</div>}
        {visible.map(p => (
          <Link key={p.id} href={`/posztleirasok/${p.id}`} className="pd-card">
            <div className="pd-card-main">
              <b>{pick(p.name_hu, p.name_ro)}</b>
              {p.lead_level !== "nincs" && <span className="lead-tag" style={{ background: "#6b7280" }}>VEZ</span>}
              <div className="muted">{place(p)}</div>
            </div>
            {data.myPostIds.has(p.id) && <span className="my-post-tag">{t("pd_my_post")}</span>}
            {badge(p.id)}
            <span className="pd-arrow">→</span>
          </Link>
        ))}
      </div>
    </>
  );
}
