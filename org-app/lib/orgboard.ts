import { supabase } from "./supabaseClient";

export type LeadLevel = "nincs" | "alosztalyvezeto" | "osztalyvezeto" | "csoportvezeto" | "ugyvezeto";

export type Person = {
  id: string; name: string; email: string | null; lang: string; active: boolean;
};
export type Holder = {
  id: string; post_id: string; person_id: string;
  valid_from: string; valid_to: string | null;
  person: Person | null;
};
export type Post = {
  id: string;
  department_id: string | null; division_id: string | null;
  group_id: string | null; org_anchor: boolean;
  lead_level: LeadLevel;
  name_hu: string; name_ro: string | null;
  evt_hu: string | null; evt_ro: string | null;
  sort: number;
  holders: Holder[];
};
export type Department = {
  id: string; division_id: string; code: string;
  name_hu: string; name_ro: string | null;
  evt_hu: string | null; evt_ro: string | null;
  sort: number;
  posts: Post[];
  leadPost: Post | null;
};
export type Division = {
  id: string; group_id: string; code: string;
  name_hu: string; name_ro: string | null;
  evt_hu: string | null; evt_ro: string | null;
  color: string; sort: number;
  departments: Department[];
  leadPost: Post | null;
};
export type Group = {
  id: string; label_hu: string; label_ro: string | null; sort: number;
  divisions: Division[];
  leadPost: Post | null;
};
export type Board = {
  org: { name: string; evt_hu: string | null; evt_ro: string | null };
  ceoPost: Post | null;
  groups: Group[];
  persons: Person[];
};

export async function loadBoard(): Promise<Board> {
  const [orgQ, groupsQ, divsQ, deptsQ, postsQ, holdersQ, personsQ] = await Promise.all([
    supabase.from("org_settings").select("*").maybeSingle(),
    supabase.from("ob_groups").select("*").order("sort"),
    supabase.from("ob_divisions").select("*").order("sort"),
    supabase.from("ob_departments").select("*").order("sort"),
    supabase.from("ob_posts").select("*").order("sort"),
    supabase.from("ob_post_holders").select("*, person:persons(*)").is("valid_to", null),
    supabase.from("persons").select("*").eq("active", true).order("name"),
  ]);
  for (const q of [orgQ, groupsQ, divsQ, deptsQ, postsQ, holdersQ, personsQ]) {
    if (q.error) throw q.error;
  }

  const holdersByPost = new Map<string, Holder[]>();
  for (const h of (holdersQ.data as unknown as Holder[]) ?? []) {
    const arr = holdersByPost.get(h.post_id) ?? [];
    arr.push(h); holdersByPost.set(h.post_id, arr);
  }
  const posts: Post[] = ((postsQ.data as Omit<Post, "holders">[]) ?? []).map(p => ({
    ...p, holders: holdersByPost.get(p.id) ?? [],
  }));

  const deptPosts = (deptId: string) =>
    posts.filter(p => p.department_id === deptId);
  const firstLead = (list: Post[], level: LeadLevel) =>
    list.find(p => p.lead_level === level) ?? null;

  const departments: Department[] = ((deptsQ.data as Department[]) ?? []).map(d => {
    const ps = deptPosts(d.id);
    return { ...d, posts: ps, leadPost: firstLead(ps, "alosztalyvezeto") };
  });
  const divisions: Division[] = ((divsQ.data as Division[]) ?? []).map(dv => ({
    ...dv,
    departments: departments.filter(d => d.division_id === dv.id),
    leadPost: firstLead(posts.filter(p => p.division_id === dv.id), "osztalyvezeto"),
  }));
  const groups: Group[] = ((groupsQ.data as Group[]) ?? []).map(g => ({
    ...g,
    divisions: divisions.filter(d => d.group_id === g.id),
    leadPost: firstLead(posts.filter(p => p.group_id === g.id), "csoportvezeto"),
  }));

  return {
    org: (orgQ.data as Board["org"]) ?? { name: "Szervezet", evt_hu: null, evt_ro: null },
    ceoPost: firstLead(posts.filter(p => p.org_anchor), "ugyvezeto"),
    groups,
    persons: (personsQ.data as Person[]) ?? [],
  };
}

// ── Mutációk (RLS dönti el, szabad-e) ────────────────────────

const fail = (e: { message?: string } | null) => { if (e) throw new Error(e.message || "DB hiba"); };

export async function updateOrgEvt(evt_hu: string, evt_ro: string) {
  const { error } = await supabase.from("org_settings").update({ evt_hu, evt_ro }).eq("id", 1);
  fail(error);
}

export async function upsertDivision(v: {
  id?: string; group_id: string; code: string; name_hu: string; name_ro: string;
  evt_hu: string; evt_ro: string; color: string; sort?: number;
}) {
  if (v.id) {
    const { id, ...rest } = v;
    const { error } = await supabase.from("ob_divisions").update(rest).eq("id", id);
    fail(error);
  } else {
    const { error } = await supabase.from("ob_divisions").insert(v);
    fail(error);
  }
}
export async function deleteDivision(id: string) {
  const { error } = await supabase.from("ob_divisions").delete().eq("id", id);
  fail(error);
}

export async function upsertDepartment(v: {
  id?: string; division_id: string; code: string; name_hu: string; name_ro: string;
  evt_hu: string; evt_ro: string; sort?: number;
}) {
  if (v.id) {
    const { id, ...rest } = v;
    const { error } = await supabase.from("ob_departments").update(rest).eq("id", id);
    fail(error);
  } else {
    const { error } = await supabase.from("ob_departments").insert(v);
    fail(error);
  }
}
export async function deleteDepartment(id: string) {
  const { error } = await supabase.from("ob_departments").delete().eq("id", id);
  fail(error);
}

export async function upsertPost(v: {
  id?: string;
  department_id?: string | null; division_id?: string | null;
  group_id?: string | null; org_anchor?: boolean;
  lead_level: LeadLevel;
  name_hu: string; name_ro: string; evt_hu: string; evt_ro: string; sort?: number;
}): Promise<string> {
  if (v.id) {
    const { id, ...rest } = v;
    const { error } = await supabase.from("ob_posts").update(rest).eq("id", id);
    fail(error);
    return id;
  } else {
    const { data, error } = await supabase.from("ob_posts").insert(v).select("id").single();
    fail(error);
    return (data as { id: string }).id;
  }
}
export async function deletePost(id: string) {
  const { error } = await supabase.from("ob_posts").delete().eq("id", id);
  fail(error);
}

/** Sorrend átírása: a megadott id-lista lesz az új sorrend (sort = 1..n). */
export async function reorderRows(table: "ob_divisions" | "ob_departments", ids: string[]) {
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase.from(table).update({ sort: i + 1 }).eq("id", ids[i]);
    fail(error);
  }
}

/** A poszt aktív betöltőit erre a személylistára állítja (történetiséggel). */
export async function setHolders(postId: string, current: Holder[], personIds: string[]) {
  const today = new Date().toISOString().slice(0, 10);
  const toClose = current.filter(h => !personIds.includes(h.person_id)).map(h => h.id);
  const have = new Set(current.map(h => h.person_id));
  const toAdd = personIds.filter(pid => !have.has(pid));
  if (toClose.length) {
    const { error } = await supabase.from("ob_post_holders")
      .update({ valid_to: today }).in("id", toClose);
    fail(error);
  }
  if (toAdd.length) {
    const { error } = await supabase.from("ob_post_holders")
      .insert(toAdd.map(pid => ({ post_id: postId, person_id: pid })));
    fail(error);
  }
}

/** Új személy gyors felvétele (admin jog kell hozzá az RLS szerint). */
export async function createPerson(name: string): Promise<Person> {
  const { data, error } = await supabase.from("persons")
    .insert({ name }).select("*").single();
  fail(error);
  return data as Person;
}
