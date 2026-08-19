"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";
import {
  Board, Division, Department, Post, Group,
  loadBoard, updateOrgEvt, upsertDivision, deleteDivision,
  upsertDepartment, deleteDepartment, upsertPost, deletePost, setHolders,
  reorderRows,
} from "@/lib/orgboard";
import Modal, { Field, FormValues } from "./Modal";

const s = (v: FormValues[string]) => (v as string) ?? "";

export default function TablaPage() {
  const { t, lang, setLang, pick } = useI18n();
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState<{ title: string; fields: Field[]; onSave: (v: FormValues) => Promise<void> } | null>(null);
  const [loadErr, setLoadErr] = useState("");

  const reload = useCallback(async () => {
    try { setBoard(await loadBoard()); }
    catch (e) { setLoadErr((e as Error).message); }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data: caps } = await supabase.from("person_capabilities").select("capability");
      const capSet = new Set((caps ?? []).map(c => c.capability));
      setCanEdit(capSet.has("admin") || capSet.has("tabla.szerkesztes"));
      await reload();
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      if (!sess) router.replace("/login");
    });
    return () => sub.subscription.unsubscribe();
  }, [router, reload]);

  useEffect(() => {
    document.body.classList.toggle("editing", editing && canEdit);
    return () => { document.body.classList.remove("editing"); };
  }, [editing, canEdit]);

  async function signOut() { await supabase.auth.signOut(); }

  // ── űrlap-nyitók ────────────────────────────────────────────
  function openPostForm(post: Post | null, anchor: Partial<Post>, title: string, allowLeadToggle: boolean) {
    if (!board) return;
    const fields: Field[] = [
      { key: "name_hu", label: t("f_name_hu"), value: post?.name_hu ?? "" },
      { key: "name_ro", label: t("f_name_ro"), value: post?.name_ro ?? "" },
      { key: "evt_hu", label: t("f_evt_hu"), type: "textarea", value: post?.evt_hu ?? "" },
      { key: "evt_ro", label: t("f_evt_ro"), type: "textarea", value: post?.evt_ro ?? "" },
      { key: "holders", label: t("f_holders"), type: "holders",
        value: post?.holders.map(h => h.person_id) ?? [], persons: board.persons },
    ];
    if (allowLeadToggle) fields.splice(4, 0,
      { key: "lead", label: t("f_lead_post"), type: "checkbox", value: post?.lead_level === "alosztalyvezeto" });
    setModal({
      title, fields,
      onSave: async v => {
        const id = await upsertPost({
          id: post?.id,
          department_id: anchor.department_id ?? null,
          division_id: anchor.division_id ?? null,
          group_id: anchor.group_id ?? null,
          org_anchor: anchor.org_anchor ?? false,
          lead_level: allowLeadToggle
            ? (v.lead ? "alosztalyvezeto" : "nincs")
            : (post?.lead_level ?? anchor.lead_level ?? "nincs"),
          name_hu: s(v.name_hu) || (post?.name_hu ?? "?"),
          name_ro: s(v.name_ro), evt_hu: s(v.evt_hu), evt_ro: s(v.evt_ro),
        });
        await setHolders(id, post?.holders ?? [], v.holders as string[]);
        await reload();
      },
    });
  }

  function openDivisionForm(div: Division | null) {
    if (!board) return;
    const fields: Field[] = [
      { key: "code", label: t("f_code"), value: div?.code ?? "" },
      { key: "name_hu", label: t("f_name_hu"), value: div?.name_hu ?? "" },
      { key: "name_ro", label: t("f_name_ro"), value: div?.name_ro ?? "" },
      { key: "evt_hu", label: t("f_evt_hu"), type: "textarea", value: div?.evt_hu ?? "" },
      { key: "evt_ro", label: t("f_evt_ro"), type: "textarea", value: div?.evt_ro ?? "" },
      { key: "color", label: t("f_color"), type: "color", value: div?.color ?? "#5b5f97" },
    ];
    const lastGroupId = board.groups[board.groups.length - 1].id;
    fields.push({ key: "grpB", label: t("f_group_b"), type: "checkbox",
                  value: div ? div.group_id === lastGroupId : true });
    setModal({
      title: div ? t("edit_division") : t("new_division"), fields,
      onSave: async v => {
        const group = v.grpB ? lastGroupId : board.groups[0].id;
        const allDivs = board.groups.flatMap(g => g.divisions);
        await upsertDivision({
          id: div?.id, group_id: group,
          code: s(v.code) || "?", name_hu: s(v.name_hu) || "?", name_ro: s(v.name_ro),
          evt_hu: s(v.evt_hu), evt_ro: s(v.evt_ro), color: s(v.color) || "#5b5f97",
          ...(div ? {} : { sort: Math.max(0, ...allDivs.map(d => d.sort)) + 1 }),
        });
        await reload();
      },
    });
  }

  function openDeptForm(div: Division, dep: Department | null) {
    setModal({
      title: dep ? t("edit_dept") : t("new_dept"),
      fields: [
        { key: "code", label: t("f_code"), value: dep?.code ?? "" },
        { key: "name_hu", label: t("f_name_hu"), value: dep?.name_hu ?? "" },
        { key: "name_ro", label: t("f_name_ro"), value: dep?.name_ro ?? "" },
        { key: "evt_hu", label: t("f_evt_hu"), type: "textarea", value: dep?.evt_hu ?? "" },
        { key: "evt_ro", label: t("f_evt_ro"), type: "textarea", value: dep?.evt_ro ?? "" },
      ],
      onSave: async v => {
        await upsertDepartment({
          id: dep?.id, division_id: div.id,
          code: s(v.code) || "?", name_hu: s(v.name_hu) || "?", name_ro: s(v.name_ro),
          evt_hu: s(v.evt_hu), evt_ro: s(v.evt_ro),
          ...(dep ? {} : { sort: Math.max(0, ...div.departments.map(d => d.sort)) + 1 }),
        });
        await reload();
      },
    });
  }

  function openOrgEvtForm() {
    if (!board) return;
    setModal({
      title: t("edit_org_evt"),
      fields: [
        { key: "evt_hu", label: t("f_evt_hu"), type: "textarea", value: board.org.evt_hu ?? "" },
        { key: "evt_ro", label: t("f_evt_ro"), type: "textarea", value: board.org.evt_ro ?? "" },
      ],
      onSave: async v => { await updateOrgEvt(s(v.evt_hu), s(v.evt_ro)); await reload(); },
    });
  }

  async function guard(msg: string, fn: () => Promise<void>) {
    if (!confirm(msg)) return;
    try { await fn(); await reload(); }
    catch (e) { alert(t("err_save") + " (" + (e as Error).message + ")"); }
  }

  async function moveDivision(d: Division, dir: -1 | 1) {
    if (!board) return;
    const g = board.groups.find(x => x.id === d.group_id);
    if (!g) return;
    const ids = g.divisions.map(x => x.id);
    const i = ids.indexOf(d.id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await reorderRows("ob_divisions", ids); await reload(); }
    catch (e) { alert(t("err_save") + " (" + (e as Error).message + ")"); }
  }

  async function moveDept(div: Division, dep: Department, dir: -1 | 1) {
    const ids = div.departments.map(x => x.id);
    const i = ids.indexOf(dep.id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await reorderRows("ob_departments", ids); await reload(); }
    catch (e) { alert(t("err_save") + " (" + (e as Error).message + ")"); }
  }

  // ── megjelenítés ────────────────────────────────────────────
  if (loadErr) return <div className="center-msg">Hiba: {loadErr}</div>;
  if (!board) return <div className="center-msg">{t("loading")}</div>;

  const divisions: (Division & { group: Group })[] =
    board.groups.flatMap(g => g.divisions.map(d => ({ ...d, group: g })));
  const N = divisions.length + (editing && canEdit ? 1 : 0);
  const cx = (i: number) => (((i + 0.5) / Math.max(N, 1)) * 100).toFixed(3) + "%";
  const groupIdx = (g: Group) =>
    divisions.map((d, i) => (d.group_id === g.id ? i : -1)).filter(i => i >= 0);
  const centerOf = (idxs: number[]) =>
    idxs.length ? ((((idxs.reduce((a, b) => a + b, 0) / idxs.length) + 0.5) / Math.max(N, 1)) * 100).toFixed(3) + "%" : "50%";

  const holderNames = (p: Post | null) =>
    p?.holders.map(h => h.person?.name ?? "?") ?? [];
  const HolderChips = ({ post }: { post: Post }) => (
    <div className="holders">
      {post.holders.map(h => (
        <span className="holder-chip" key={h.id}>
          <span className="avatar" style={{ background: avColor(h.person?.name ?? "?") }}>
            {initials(h.person?.name ?? "?")}
          </span>
          {h.person?.name ?? "?"}
        </span>
      ))}
    </div>
  );

  const groupCenters = board.groups.map(g => centerOf(groupIdx(g)));
  const minC = groupCenters.length ? groupCenters[0] : "50%";
  const maxC = groupCenters.length ? groupCenters[groupCenters.length - 1] : "50%";

  return (
    <>
      <header className="appbar">
        <span className="t">{board.org.name} — {t("org_board")}</span>
        <span className="sp" />
        <select className="lang-select" value={lang}
                onChange={e => setLang(e.target.value as "hu" | "ro")} aria-label="Nyelv / Limba">
          <option value="hu">HU — magyar</option>
          <option value="ro">RO — română</option>
        </select>
        {canEdit && (
          <label className="switch" onClick={e => { e.preventDefault(); setEditing(v => !v); }}>
            <span className="track"><span className="knob" /></span>
            <span>{editing ? t("edit_mode_on") : t("edit_mode")}</span>
          </label>
        )}
        <button className="lang-btn" onClick={signOut}>{t("sign_out")}</button>
      </header>
      <div className="hint">{t("edit_hint")}</div>

      <div className="sheet"><div className="paper">
        {/* Ügyvezető */}
        <div className="ceo-row">
          <div className="ceo">
            <div className="role">{board.ceoPost ? pick(board.ceoPost.name_hu, board.ceoPost.name_ro) : t("ceo")}</div>
            <div className="who">
              {holderNames(board.ceoPost).length
                ? holderNames(board.ceoPost).map(n => (
                    <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="avatar" style={{ background: avColor(n) }}>{initials(n)}</span>{n}
                    </span>))
                : <span className="empty-tag">{t("vacant")}</span>}
              {board.ceoPost && (
                <button className="pencil edit-only"
                  onClick={() => openPostForm(board.ceoPost, { org_anchor: true, lead_level: "ugyvezeto" }, t("edit_post"), false)}>✎</button>
              )}
            </div>
          </div>
        </div>

        {/* vonalak: ügyvezető → csoportvezetők */}
        <div className="wires">
          <div className="v" style={{ left: "50%", top: 0, height: 12 }} />
          <div className="h" style={{ left: `min(${minC}, 50%)`, top: 12, width: `calc(max(${maxC}, 50%) - min(${minC}, 50%))` }} />
          {groupCenters.map((c, i) => <div className="v" key={i} style={{ left: c, top: 12, height: 14 }} />)}
        </div>

        {/* csoportvezetők */}
        <div className="gridN glead-row" style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
          {board.groups.map(g => {
            const idxs = groupIdx(g);
            if (!idxs.length) return null;
            return (
              <div className="glead" key={g.id}
                   style={{ gridColumn: `${idxs[0] + 1} / ${idxs[idxs.length - 1] + 2}` }}>
                <div className="role">
                  {pick(g.label_hu, g.label_ro)} · {g.divisions.map(d => d.code).join(" / ")}
                </div>
                <div className="who">
                  {holderNames(g.leadPost).length
                    ? holderNames(g.leadPost).map(n => (
                        <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span className="avatar" style={{ background: avColor(n) }}>{initials(n)}</span>{n}
                        </span>))
                    : <span className="empty-tag">{t("vacant")}</span>}
                  {g.leadPost && (
                    <button className="pencil edit-only"
                      onClick={() => openPostForm(g.leadPost, { group_id: g.id, lead_level: "csoportvezeto" }, t("edit_post"), false)}>✎</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* vonalak: csoportvezetők → osztályok */}
        <div className="wires" style={{ height: 24 }}>
          {board.groups.map((g, gi) => {
            const idxs = groupIdx(g);
            if (!idxs.length) return null;
            const c = groupCenters[gi];
            return (
              <span key={g.id}>
                <div className="v" style={{ left: c, top: 0, height: 10 }} />
                <div className="h" style={{ left: cx(idxs[0]), top: 10, width: `calc(${cx(idxs[idxs.length - 1])} - ${cx(idxs[0])})` }} />
                {idxs.map(i => <div className="v" key={i} style={{ left: cx(i), top: 10, height: 14 }} />)}
              </span>
            );
          })}
        </div>

        {/* osztályok */}
        <div className="gridN" style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
          {divisions.map((d, di) => (
            <div className="division" key={d.id} id={"div-" + di}>
              <div className="div-head" style={{ background: d.color }}>
                <div className="num">
                  <span>{d.code}. {t("division")}</span>
                  <span>
                    <button className="pencil edit-only" onClick={() => moveDivision(d, -1)}>◀</button>
                    <button className="pencil edit-only" onClick={() => moveDivision(d, 1)}>▶</button>
                    <button className="pencil edit-only" onClick={() => openDivisionForm(d)}>✎</button>
                    <button className="del edit-only"
                      onClick={() => guard(t("confirm_del_div"), () => deleteDivision(d.id))}>✕</button>
                  </span>
                </div>
                <div className="name">{pick(d.name_hu, d.name_ro)}</div>
                <div className="div-lead">
                  {holderNames(d.leadPost).length
                    ? <><b>{holderNames(d.leadPost).join(", ")}</b> <span className="rl">— {t("division_leader")}</span></>
                    : <><span className="empty-tag">{t("vacant")}</span> <span className="rl">{t("division_leader")}</span></>}
                  {d.leadPost
                    ? <button className="pencil edit-only"
                        onClick={() => openPostForm(d.leadPost, { division_id: d.id, lead_level: "osztalyvezeto" }, t("edit_post"), false)}>✎</button>
                    : <button className="pencil edit-only"
                        onClick={() => openPostForm(null, { division_id: d.id, lead_level: "osztalyvezeto" }, t("new_post"), false)}>＋</button>}
                </div>
              </div>

              {d.departments.map(dep => (
                <div className="dept" key={dep.id}>
                  <div className="dept-title">
                    <span className="dnum" style={{ background: d.color }}>{dep.code}</span>
                    <span className="dname">{pick(dep.name_hu, dep.name_ro)}</span>
                    <button className="pencil edit-only" onClick={() => moveDept(d, dep, -1)}>↑</button>
                    <button className="pencil edit-only" onClick={() => moveDept(d, dep, 1)}>↓</button>
                    <button className="pencil edit-only" onClick={() => openDeptForm(d, dep)}>✎</button>
                    <button className="del edit-only"
                      onClick={() => guard(t("confirm_del_dept"), () => deleteDepartment(dep.id))}>✕</button>
                  </div>
                  <div className="dept-lead">
                    {holderNames(dep.leadPost).length
                      ? <>{holderNames(dep.leadPost).join(", ")} — {t("dept_leader")}</>
                      : <><span className="empty-tag">{t("vacant")}</span> {t("dept_leader")}</>}
                  </div>
                  {dep.posts.map(p => (
                    <div className={"post" + (p.holders.length ? "" : " empty")} key={p.id}
                         onClick={e => (e.currentTarget as HTMLElement).classList.toggle("open")}>
                      <div className="post-row">
                        <span className="post-name">
                          {pick(p.name_hu, p.name_ro)}
                          {p.lead_level !== "nincs" && <span className="lead-tag" style={{ background: d.color }}>{t("lead_tag")}</span>}
                        </span>
                        {!p.holders.length && <span className="empty-tag">{t("vacant")}</span>}
                        <button className="pencil edit-only"
                          onClick={e => { e.stopPropagation(); openPostForm(p, { department_id: dep.id }, t("edit_post"), true); }}>✎</button>
                        <button className="del edit-only"
                          onClick={e => { e.stopPropagation(); guard(t("confirm_del_post"), () => deletePost(p.id)); }}>✕</button>
                      </div>
                      {p.holders.length > 0 && <HolderChips post={p} />}
                      <div className="post-detail">
                        <b>{t("post_evt")}:</b> {pick(p.evt_hu, p.evt_ro) || "—"}
                      </div>
                    </div>
                  ))}
                  <button className="add-btn edit-only"
                    onClick={() => openPostForm(null, { department_id: dep.id }, t("new_post"), true)}>{t("add_post")}</button>
                  <div className="dept-evt"><b>{t("dept_evt")}</b> · {pick(dep.evt_hu, dep.evt_ro) || "—"}</div>
                </div>
              ))}

              <div className="dept edit-only" style={{ borderTop: "none", paddingTop: 0 }}>
                <button className="add-btn" onClick={() => openDeptForm(d, null)}>{t("add_dept")}</button>
              </div>

              <div className="div-evt">
                <div className="box" style={{ borderColor: d.color }}>
                  <b style={{ color: d.color }}>{t("division_evt")}</b>
                  {pick(d.evt_hu, d.evt_ro) || "—"}
                  <button className="pencil edit-only" onClick={() => openDivisionForm(d)}>✎</button>
                </div>
              </div>
            </div>
          ))}
          {editing && canEdit && (
            <button className="ghost-col" onClick={() => openDivisionForm(null)}>
              <span>{t("add_division")}</span>
              <span style={{ fontSize: 11 }}>{t("add_division_sub")}</span>
            </button>
          )}
        </div>

        {/* szervezet EVT */}
        <div className="org-evt">
          <b>{t("org_evt")}</b>
          <span>
            {pick(board.org.evt_hu, board.org.evt_ro) || "—"}
            <button className="pencil edit-only" onClick={openOrgEvtForm}>✎</button>
          </span>
        </div>
      </div></div>

      {modal && <Modal title={modal.title} fields={modal.fields}
                       onSave={modal.onSave} onClose={() => setModal(null)} />}
    </>
  );
}

// ── kis segédek ───────────────────────────────────────────────
const AV_COLORS = ["#2f6fed", "#0e7c86", "#b3541e", "#2e7d32", "#8e3b8e", "#c2851a", "#1565c0", "#5b5f97"];
const avColor = (s: string) => AV_COLORS[(s.charCodeAt(0) || 0) % AV_COLORS.length];
const initials = (n: string) => n.trim().split(/\s+/).map(w => w[0] || "").join("").slice(0, 2);
