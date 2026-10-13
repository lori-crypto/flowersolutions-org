"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, withAuthRetry } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";
import { TopNav } from "@/lib/TopNav";
import { LeaveBoard, BoardMember, setMembership } from "@/lib/leave";

type PersonRow = {
  id: string; user_id: string | null; name: string; email: string | null;
  phone: string | null; lang: string; active: boolean;
};

const CAPS = [
  { key: "admin", tk: "cap_admin" },
  { key: "hr", tk: "cap_hr" },
  { key: "tabla.szerkesztes", tk: "cap_tabla" },
  { key: "posztleiras.szerkesztes", tk: "cap_posztleiras" },
  { key: "penztar", tk: "cap_penztar" },
];

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
  const [isAdmin, setIsAdmin] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [pcaps, setPcaps] = useState<{ person_id: string; capability: string }[]>([]);
  const [cashUnits, setCashUnits] = useState<{ id: string; name_hu: string; name_ro: string | null; sort: number }[]>([]);
  const [cashMembers, setCashMembers] = useState<{ unit_id: string; person_id: string }[]>([]);
  const [edit, setEdit] = useState<PersonRow | null>(null);
  const [accountFor, setAccountFor] = useState<PersonRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");

  const reload = useCallback(async () => await withAuthRetry(async () => {
    const [pQ, bQ, mQ, cQ, uQ, umQ] = await Promise.all([
      supabase.from("persons").select("*").order("active", { ascending: false }).order("name"),
      supabase.from("leave_boards").select("*").order("sort"),
      supabase.from("board_members").select("*"),
      supabase.from("person_capabilities").select("person_id, capability"),
      supabase.from("cash_units").select("id, name_hu, name_ro, sort").eq("active", true).order("sort"),
      supabase.from("cash_unit_members").select("unit_id, person_id"),
    ]);
    if (pQ.error) { setErr(pQ.error.message); return; }
    setPersons((pQ.data as PersonRow[]) ?? []);
    setBoards((bQ.data as LeaveBoard[]) ?? []);
    setMembers((mQ.data as BoardMember[]) ?? []);
    setPcaps((cQ.data as { person_id: string; capability: string }[]) ?? []);
    setCashUnits((uQ.data as { id: string; name_hu: string; name_ro: string | null; sort: number }[]) ?? []);
    setCashMembers((umQ.data as { unit_id: string; person_id: string }[]) ?? []);
  }), []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setMyUserId(session.user.id);
      const { data: me } = await supabase.from("persons")
        .select("id").eq("user_id", session.user.id).maybeSingle();
      const { data: caps } = await supabase.from("person_capabilities")
        .select("person_id, capability");
      const mine = new Set((caps ?? [])
        .filter(c => c.person_id === me?.id).map(c => c.capability));
      setIsHr(mine.has("hr") || mine.has("admin"));
      setIsAdmin(mine.has("admin"));
      await reload();
    })();
  }, [router, reload]);

  async function toggleCashUnit(p: PersonRow, unitId: string, on: boolean) {
    const q = on
      ? supabase.from("cash_unit_members").insert({ unit_id: unitId, person_id: p.id })
      : supabase.from("cash_unit_members").delete()
          .eq("unit_id", unitId).eq("person_id", p.id);
    const { error } = await q;
    if (error) { alert(error.message); }
    await reload();
  }

  async function toggleCap(p: PersonRow, cap: string, on: boolean) {
    const q = on
      ? supabase.from("person_capabilities").insert({ person_id: p.id, capability: cap })
      : supabase.from("person_capabilities").delete()
          .eq("person_id", p.id).eq("capability", cap);
    const { error } = await q;
    if (error) { alert(error.message); }
    await reload();
  }

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
        <TopNav active="people" />
        <span className="sp" />
        <button className="lang-btn" title="Frissítés" onClick={() => window.location.reload()}>↻</button>
        <select className="lang-select" value={lang}
                onChange={e => setLang(e.target.value as "hu" | "ro")}>
          <option value="hu">HU — magyar</option>
          <option value="ro">RO — română</option>
        </select>
        <button className="lang-btn" onClick={() => supabase.auth.signOut()}>{t("sign_out")}</button>
      </header>

      {!isHr ? (
        <div className="center-msg">{t("stat_no_access")}</div>
      ) : (
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
                : <>
                    <span className="acct-tag">{t("p_no_account")}</span>
                    {isAdmin && p.active && (
                      <button className="mini-btn" onClick={() => setAccountFor(p)}>＋ {t("p_create_acct")}</button>
                    )}
                  </>}
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
            {isAdmin && p.active && cashUnits.length > 0 && (
              <div className="person-boards">
                <span className="muted">{t("p_cash_units")}:</span>
                {cashUnits.map(u => {
                  const on = cashMembers.some(m => m.person_id === p.id && m.unit_id === u.id);
                  return (
                    <label key={u.id} className="board-check">
                      <input type="checkbox" checked={on}
                             onChange={e => toggleCashUnit(p, u.id, e.target.checked)} />
                      {pick(u.name_hu, u.name_ro ?? u.name_hu)}
                    </label>
                  );
                })}
              </div>
            )}
            {isAdmin && p.active && (
              <div className="person-boards">
                <span className="muted">{t("p_caps")}:</span>
                {CAPS.map(c => {
                  const on = pcaps.some(x => x.person_id === p.id && x.capability === c.key);
                  const lockedSelf = c.key === "admin" && on && p.user_id === myUserId;
                  return (
                    <label key={c.key} className="board-check"
                           title={lockedSelf ? t("cap_self_lock") : undefined}
                           style={lockedSelf ? { opacity: .6 } : undefined}>
                      <input type="checkbox" checked={on} disabled={lockedSelf}
                             onChange={e => toggleCap(p, c.key, e.target.checked)} />
                      {t(c.tk)}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        <div className="fhint" style={{ marginTop: 14 }}>{t("p_hint")}</div>
      </div>
      )}

      {(adding || edit) && (
        <PersonForm person={edit} onClose={() => { setAdding(false); setEdit(null); }}
                    onSaved={async () => { setAdding(false); setEdit(null); await reload(); }} />
      )}
      {accountFor && (
        <AccountModal person={accountFor}
                      onClose={async () => { setAccountFor(null); await reload(); }} />
      )}
    </>
  );
}

function genPassword(): string {
  const a = Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(0, 5);
  const n = Math.floor(1000 + Math.random() * 9000);
  return `Fs-${a}-${n}`;
}

function AccountModal({ person, onClose }: {
  person: PersonRow;
  onClose: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState(person.email ?? "");
  const [pw, setPw] = useState(genPassword());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function create() {
    setBusy(true); setErr("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Nincs bejelentkezés. / Nu ești autentificat.");
      const r = await fetch("/api/create-user", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: person.id, email: email.trim(), password: pw }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Hiba");
      setDone(true);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal">
        <h3>{t("p_create_acct")} — {person.name}</h3>
        {!done ? (
          <>
            <label>{t("p_email")}</label>
            <input type="text" inputMode="email" value={email}
                   onChange={e => setEmail(e.target.value)} autoFocus />
            <label>{t("p_acct_pw")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" value={pw} onChange={e => setPw(e.target.value)}
                     style={{ fontFamily: "ui-monospace, Consolas, monospace", fontWeight: 700 }} />
              <button className="mini-btn" onClick={() => setPw(genPassword())}>↻</button>
            </div>
            <div className="fhint" style={{ marginTop: 10 }}>{t("p_acct_hint")}</div>
            {err && <div className="err">{err}</div>}
            <div className="btns">
              <button className="btn-cancel" onClick={onClose} disabled={busy}>{t("cancel")}</button>
              <button className="btn-save" onClick={create}
                      disabled={busy || !email.trim() || pw.length < 8}>
                {busy ? "⏳" : t("p_acct_btn")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="fhint" style={{ background: "#e6f4ea", color: "#1d5a33" }}>{t("p_acct_done")}</div>
            <label>{t("p_email")}</label>
            <input type="text" value={email} readOnly />
            <label>{t("p_acct_pw")}</label>
            <input type="text" value={pw} readOnly
                   style={{ fontFamily: "ui-monospace, Consolas, monospace", fontWeight: 700, fontSize: 16 }} />
            <div className="btns">
              <button className="btn-save" onClick={onClose}>{t("close")}</button>
            </div>
          </>
        )}
      </div>
    </div>
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
