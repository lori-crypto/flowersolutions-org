"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, withAuthRetry } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";
import { LeaveBoard, BoardMember, setMembership } from "@/lib/leave";

type PersonRow = {
  id: string; user_id: string | null; name: string; email: string | null;
  phone: string | null; lang: string; active: boolean;
};

const AV_COLORS = ["#2f6fed", "#0e7c86", "#b3541e", "#2e7d32", "#8e3b8e", "#c2851a", "#1565c0", "#5b5f97"];
const avColor = (s: string) => AV_COLORS[(s.charCodeAt(0) || 0) % AV_COLORS.length];
const initialsOf = (n: string) => n.trim().split(/\s+/).map(w => w[0] || "").join("").slice(0, 2);

export default function KollegakPage() {
  const { t, lang, setLang, pick } = useI18n();
  const router = useRouter();
  const [persons, setPersons] = useState<PersonRow[] | null>(null);
  const [boards, setBoards] = useState<LeaveBoard[]>([]);
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [isHr, setIsHr] = useState(false);
  const [edit, setEdit] = useState<PersonRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");

  const reload = useCallback(async () => await withAuthRetry(async () => {
    const [pQ, bQ, mQ] = await Promise.all([
      supabase.from("persons").select("*").order("active", { ascending: false }).order("name"),
      supabase.from("leave_boards").select("*").order("sort"),
      supabase.from("board_members").select("*"),
    ]);
    if (pQ.error) { setErr(pQ.error.message); return; }
    setPersons((pQ.data as PersonRow[]) ?? []);
    setBoards((bQ.data as LeaveBoard[]) ?? []);
    setMembers((mQ.data as BoardMember[]) ?? []);
  }), []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data: caps } = await supabase.from("person_capabilities").select("capability");
      const capSet = new Set((caps ?? []).map(c => c.capability));
      setIsHr(capSet.has("hr") || capSet.has("admin"));
      await reload();
    })();
  }, [router, reload]);

  async function toggleActive(p: PersonRow) {
    const { error } = await supabase.from("persons").update({ active: !p.active }).eq("id", p.id);
    if (error) { alert(t("err_save") + " (" + error.message + ")"); return; }
    await reload();
  }

  if (err) return <div className="center-msg">Hiba: {err}</div>;
  if (!persons) return <div className="center-msg">{t("loading")}</div>;

  return (
    <>
      <header className="appbar">
        <span className="t">{t("people_title")}</span>
        <nav className="topnav">
          <Link href="/tabla">{t("nav_tabla")}</Link>
          <Link href="/szabadsag">{t("nav_leave")}</Link>
          <Link href="/kollegak" className="active">{t("nav_people")}</Link>
          <Link href="/posztleirasok">{t("nav_desc")}</Link>
          <Link href="/statisztika">{t("nav_stat")}</Link>
        </nav>
        <span className="sp" />
        <button className="lang-btn" title="Frissítés" onClick={() => window.location.reload()}>↻</button>
        <select className="lang-select" value={lang}
                onChange={e => setLang(e.target.value as "hu" | "ro")}>
          <option value="hu">HU — magyar</option>
          <option value="ro">RO — română</option>
        </select>
        <button className="lang-btn" onClick={() => supabase.auth.signOut()}>{t("sign_out")}</button>
      </header>

      <div className="people-wrap">
        {isHr && (
          <button className="add-btn" style={{ marginBottom: 12 }}
                  onClick={() => setAdding(true)}>{t("p_add")}</button>
        )}
        {persons.map(p => (
          <div className={"person-card" + (p.active ? "" : " inactive")} key={p.id}>
            <div className="person-head">
              <span className="avatar" style={{ background: avColor(p.name) }}>{initialsOf(p.name)}</span>
              <b>{p.name}</b>
              {!p.active && <span className="empty-tag">{t("p_inactive")}</span>}
              {p.user_id
                ? <span className="acct-tag ok">✓ {t("p_account")}</span>
                : <span className="acct-tag">{t("p_no_account")}</span>}
              <span className="sp" />
              {isHr && <>
                <button className="pencil" onClick={() => setEdit(p)}>✎</button>
                <button className="mini-btn" onClick={() => toggleActive(p)}>
                  {p.active ? t("p_deact") : t("p_react")}
                </button>
              </>}
            </div>
            <div className="person-meta">
              {p.email && <span>✉ {p.email}</span>}
              {p.phone && <span>☎ {p.phone}</span>}
              <span>{p.lang.toUpperCase()}</span>
            </div>
            {isHr && p.active && boards.length > 0 && (
              <div className="person-boards">
                <span className="muted">{t("p_boards")}:</span>
                {boards.map(b => {
                  const on = members.some(m => m.person_id === p.id && m.board_id === b.id);
                  return (
                    <label key={b.id} className="board-check">
                      <input type="checkbox" checked={on}
                             onChange={async e => {
                               try { await setMembership(p.id, b.id, e.target.checked); await reload(); }
                               catch (ex) { alert((ex as Error).message); }
                             }} />
                      {pick(b.name_hu, b.name_ro)}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        <div className="fhint" style={{ marginTop: 14 }}>{t("p_hint")}</div>
      </div>

      {(adding || edit) && (
        <PersonForm person={edit} onClose={() => { setAdding(false); setEdit(null); }}
                    onSaved={async () => { setAdding(false); setEdit(null); await reload(); }} />
      )}
    </>
  );
}

function PersonForm({ person, onClose, onSaved }: {
  person: PersonRow | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(person?.name ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [plang, setPlang] = useState(person?.lang ?? "hu");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!name.trim()) return;
    setBusy(true); setErr("");
    const row = { name: name.trim(), email: email.trim() || null,
                  phone: phone.trim() || null, lang: plang };
    const q = person
      ? supabase.from("persons").update(row).eq("id", person.id)
      : supabase.from("persons").insert(row);
    const { error } = await q;
    if (error) { setErr(t("err_save") + " (" + error.message + ")"); setBusy(false); return; }
    await onSaved();
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>{person ? t("p_edit") : t("p_add")}</h3>
        <label>{t("p_name")}</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus />
        <label>{t("p_email")}</label>
        <input type="text" value={email} onChange={e => setEmail(e.target.value)}
               placeholder="—" inputMode="email" />
        <label>{t("p_phone")}</label>
        <input type="text" value={phone} onChange={e => setPhone(e.target.value)}
               placeholder="—" inputMode="tel" />
        <label>{t("p_lang")}</label>
        <select className="sel" value={plang} onChange={e => setPlang(e.target.value)}>
          <option value="hu">Magyar</option>
          <option value="ro">Română</option>
        </select>
        {err && <div className="err">{err}</div>}
        <div className="btns">
          <button className="btn-cancel" onClick={onClose}>{t("cancel")}</button>
          <button className="btn-save" onClick={save} disabled={busy || !name.trim()}>{t("save")}</button>
        </div>
      </div>
    </div>
  );
}
