"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, withAuthRetry } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";
import { mdToHtml } from "@/lib/md";
import {
  loadPostDetail, saveDraft, publishDraft, upsertTerm, deleteTerm,
  PostDescription, GlossaryTerm, PostMeta,
} from "@/lib/postdesc";

type Detail = Awaited<ReturnType<typeof loadPostDetail>>;
const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default function PosztleirasDetailPage() {
  const { t, lang, setLang, pick } = useI18n();
  const router = useRouter();
  const params = useParams<{ postId: string }>();
  const postId = params.postId;

  const [data, setData] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftHu, setDraftHu] = useState("");
  const [draftRo, setDraftRo] = useState("");
  const [busy, setBusy] = useState(false);
  const [popTerm, setPopTerm] = useState<GlossaryTerm | null>(null);
  const [termForm, setTermForm] = useState<Partial<GlossaryTerm> | null>(null);
  const [showGloss, setShowGloss] = useState(false);

  const reload = useCallback(async () => {
    try { setData(await withAuthRetry(() => loadPostDetail(postId))); }
    catch (e) { setErr((e as Error).message); }
  }, [postId]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      await reload();
    })();
  }, [router, reload]);

  if (err) return <div className="center-msg">Hiba: {err}</div>;
  if (!data) return <div className="center-msg">{t("loading")}</div>;
  if (!data.post) return <div className="center-msg">{t("pd_no_access")}</div>;

  const post = data.post as PostMeta;
  const active = data.descs.find(d => d.status === "ervenyes") ?? null;
  const draft = data.descs.find(d => d.status === "vazlat") ?? null;
  const nextVersion = Math.max(0, ...data.descs.map(d => d.version)) + 1;

  const place = () => {
    if (post.department) {
      const dv = post.department.division;
      return (dv ? pick(dv.name_hu, dv.name_ro) + " · " : "") + pick(post.department.name_hu, post.department.name_ro);
    }
    if (post.division) return pick(post.division.name_hu, post.division.name_ro);
    if (post.group) return pick(post.group.label_hu, post.group.label_ro);
    return t("pd_org_level");
  };

  function startEdit() {
    setDraftHu(draft?.content_hu ?? active?.content_hu ?? defaultTemplate(t));
    setDraftRo(draft?.content_ro ?? active?.content_ro ?? "");
    setEditing(true);
  }

  async function doSaveDraft(): Promise<string | null> {
    setBusy(true);
    try {
      const id = await saveDraft(postId, draft?.id ?? null, nextVersion, draftHu, draftRo);
      await reload();
      setBusy(false);
      return id;
    } catch (e) { alert((e as Error).message); setBusy(false); return null; }
  }

  async function doPublish() {
    if (!confirm(t("pd_publish_confirm"))) return;
    setBusy(true);
    try {
      const id = await saveDraft(postId, draft?.id ?? null, nextVersion, draftHu, draftRo);
      await publishDraft(postId, id);
      await reload();
      setEditing(false);
    } catch (e) { alert((e as Error).message); }
    setBusy(false);
  }

  const shown = active;
  const content = shown ? pick(shown.content_hu, shown.content_ro) : "";

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
        <select className="lang-select" value={lang}
                onChange={e => setLang(e.target.value as "hu" | "ro")}>
          <option value="hu">HU — magyar</option>
          <option value="ro">RO — română</option>
        </select>
        <button className="lang-btn" onClick={() => supabase.auth.signOut()}>{t("sign_out")}</button>
      </header>

      <div className="pd-wrap">
        <Link href="/posztleirasok" className="pd-back">← {t("pd_all")}</Link>
        <div className="pd-head">
          <h1>{pick(post.name_hu, post.name_ro)}</h1>
          <div className="muted">{place()}</div>
          {(post.evt_hu || post.evt_ro) && (
            <div className="pd-evt"><b>{t("post_evt")}:</b> {pick(post.evt_hu, post.evt_ro)}</div>
          )}
          <div className="pd-meta">
            {active
              ? <span className="acct-tag ok">v{active.version} · {t("pd_published")}</span>
              : <span className="acct-tag">{t("pd_missing")}</span>}
            {draft && <span className="acct-tag">{t("pd_draft")} (v{draft.version})</span>}
            {data.canEdit && !editing && (
              <button className="mini-btn" onClick={startEdit}>✎ {t("pd_edit")}</button>
            )}
          </div>
        </div>

        {editing ? (
          <div className="pd-editor">
            <div className="fhint">{t("pd_md_hint")}</div>
            <label>{t("pd_content")} (HU)</label>
            <textarea value={draftHu} onChange={e => setDraftHu(e.target.value)} rows={16} />
            <label>{t("pd_content")} (RO)</label>
            <textarea value={draftRo} onChange={e => setDraftRo(e.target.value)} rows={10} />
            <div className="btns" style={{ justifyContent: "flex-start" }}>
              <button className="btn-cancel" onClick={() => setEditing(false)}>{t("cancel")}</button>
              <button className="mini-btn" disabled={busy} onClick={doSaveDraft}>{t("pd_save_draft")}</button>
              <button className="btn-save" disabled={busy || !draftHu.trim()} onClick={doPublish}>
                {t("pd_publish")} (v{nextVersion})
              </button>
            </div>
            <div className="pd-preview">
              <h4 className="muted">{t("pd_preview")}</h4>
              <RichContent html={mdToHtml(lang === "ro" ? (draftRo || draftHu) : draftHu)}
                           terms={data.terms} onTerm={setPopTerm} />
            </div>
          </div>
        ) : shown ? (
          <RichContent html={mdToHtml(content)} terms={data.terms} onTerm={setPopTerm} />
        ) : (
          <div className="center-msg">{t("pd_not_written")}</div>
        )}

        {/* Szószedet */}
        <div className="admin-box" style={{ padding: 0, marginTop: 18 }}>
          <button className="admin-toggle" onClick={() => setShowGloss(v => !v)}>
            📖 {t("pd_glossary")} ({data.terms.length}) {showGloss ? "▴" : "▾"}
          </button>
          {showGloss && (
            <div className="admin-panel">
              {data.terms.map(term => (
                <div className="my-row" key={term.id}>
                  <b>{term.term}</b>
                  <span className="muted">{pick(term.def_hu, term.def_ro)}</span>
                  {term.post_id && <span className="acct-tag">{t("pd_term_local")}</span>}
                  {data.canEdit && <>
                    <button className="pencil" onClick={() => setTermForm(term)}>✎</button>
                    <button className="del" onClick={async () => {
                      if (!confirm(t("pd_term_del"))) return;
                      try { await deleteTerm(term.id); await reload(); }
                      catch (e) { alert((e as Error).message); }
                    }}>✕</button>
                  </>}
                </div>
              ))}
              {data.canEdit && (
                <button className="add-btn" onClick={() => setTermForm({ post_id: postId })}>
                  ＋ {t("pd_term_add")}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="fhint" style={{ marginTop: 14 }}>{t("pd_checksheet_soon")}</div>
      </div>

      {/* szó-definíció buborék */}
      {popTerm && (
        <div className="overlay" onClick={e => { if (e.target === e.currentTarget) setPopTerm(null); }}>
          <div className="modal" style={{ maxWidth: 380 }}>
            <h3>{popTerm.term}</h3>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>{pick(popTerm.def_hu, popTerm.def_ro)}</p>
            {(popTerm.example_hu || popTerm.example_ro) && (
              <p className="muted" style={{ marginTop: 8, fontStyle: "italic" }}>
                „{pick(popTerm.example_hu ?? "", popTerm.example_ro)}"
              </p>
            )}
            <div className="btns">
              <button className="btn-cancel" onClick={() => setPopTerm(null)}>{t("close")}</button>
            </div>
          </div>
        </div>
      )}

      {termForm && (
        <TermForm init={termForm} postId={postId}
                  onClose={() => setTermForm(null)}
                  onSaved={async () => { setTermForm(null); await reload(); }} />
      )}
    </>
  );
}

function defaultTemplate(t: (k: string) => string): string {
  return `# ${t("pd_tpl_purpose")}\n\n\n## ${t("pd_tpl_duties")}\n\n- \n\n## ${t("pd_tpl_procedures")}\n\n`;
}

/** Renderelt tartalom szószedet-kiemeléssel. */
function RichContent({ html, terms, onTerm }: {
  html: string; terms: GlossaryTerm[]; onTerm: (t: GlossaryTerm) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.innerHTML = html;
    if (!terms.length) return;
    const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
    let rx: RegExp;
    try {
      rx = new RegExp(`(?<![\\p{L}\\p{N}])(${sorted.map(x => escRx(x.term)).join("|")})(?![\\p{L}\\p{N}])`, "giu");
    } catch { return; }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const n of nodes) {
      rx.lastIndex = 0;
      if (!rx.test(n.data)) continue;
      rx.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0; let m: RegExpExecArray | null;
      while ((m = rx.exec(n.data))) {
        const matched = m[0];
        frag.append(n.data.slice(last, m.index));
        const s = document.createElement("span");
        s.className = "gl-term"; s.textContent = matched;
        const found = sorted.find(x => x.term.toLowerCase() === matched.toLowerCase())
          ?? sorted.find(x => matched.toLowerCase().includes(x.term.toLowerCase()));
        if (found) s.onclick = ev => { ev.stopPropagation(); onTerm(found); };
        frag.append(s);
        last = m.index + matched.length;
      }
      frag.append(n.data.slice(last));
      n.replaceWith(frag);
    }
  }, [html, terms, onTerm]);
  return <div className="desc-body" ref={ref} />;
}

function TermForm({ init, postId, onClose, onSaved }: {
  init: Partial<GlossaryTerm>; postId: string;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [term, setTerm] = useState(init.term ?? "");
  const [defHu, setDefHu] = useState(init.def_hu ?? "");
  const [defRo, setDefRo] = useState(init.def_ro ?? "");
  const [exHu, setExHu] = useState(init.example_hu ?? "");
  const [exRo, setExRo] = useState(init.example_ro ?? "");
  const [global, setGlobal] = useState(init.id ? init.post_id == null : false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    try {
      await upsertTerm({ id: init.id, term, def_hu: defHu, def_ro: defRo,
        example_hu: exHu, example_ro: exRo, post_id: global ? null : postId });
      await onSaved();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>{init.id ? t("pd_term_edit") : t("pd_term_add")}</h3>
        <label>{t("pd_term")}</label>
        <input type="text" value={term} onChange={e => setTerm(e.target.value)} autoFocus />
        <label>{t("pd_def")} (HU)</label>
        <textarea value={defHu} onChange={e => setDefHu(e.target.value)} />
        <label>{t("pd_def")} (RO)</label>
        <textarea value={defRo} onChange={e => setDefRo(e.target.value)} />
        <label>{t("pd_example")} (HU)</label>
        <input type="text" value={exHu} onChange={e => setExHu(e.target.value)} />
        <label>{t("pd_example")} (RO)</label>
        <input type="text" value={exRo} onChange={e => setExRo(e.target.value)} />
        <div className="chk">
          <input type="checkbox" id="glb" checked={global} onChange={e => setGlobal(e.target.checked)} />
          <label htmlFor="glb" style={{ margin: 0, textTransform: "none", fontSize: 13.5, color: "var(--ink)" }}>
            {t("pd_term_global")}
          </label>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="btns">
          <button className="btn-cancel" onClick={onClose}>{t("cancel")}</button>
          <button className="btn-save" onClick={save}
                  disabled={busy || !term.trim() || !defHu.trim()}>{t("save")}</button>
        </div>
      </div>
    </div>
  );
}
