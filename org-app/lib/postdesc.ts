import { supabase } from "./supabaseClient";

export type DescStatus = "vazlat" | "ervenyes" | "archiv";
export type PostDescription = {
  id: string; post_id: string; version: number; status: DescStatus;
  content_hu: string; content_ro: string | null;
  created_at: string; published_at: string | null;
};
export type GlossaryTerm = {
  id: string; term: string; def_hu: string; def_ro: string | null;
  example_hu: string | null; example_ro: string | null; post_id: string | null;
};
export type PostMeta = {
  id: string; name_hu: string; name_ro: string | null;
  evt_hu: string | null; evt_ro: string | null; lead_level: string;
  department: { code: string; name_hu: string; name_ro: string | null;
    division: { code: string; name_hu: string; name_ro: string | null } | null } | null;
  division: { code: string; name_hu: string; name_ro: string | null } | null;
  group: { label_hu: string; label_ro: string | null } | null;
  org_anchor: boolean;
};

const fail = (e: { message?: string } | null) => { if (e) throw new Error(e.message || "DB hiba"); };

export async function loadPostList() {
  const [{ data: { session } }, postsQ, descQ, capsQ, holdersQ] = await Promise.all([
    supabase.auth.getSession(),
    supabase.from("ob_posts").select(
      "id, name_hu, name_ro, lead_level, org_anchor, sort," +
      "department:ob_departments(code, name_hu, name_ro, sort, division:ob_divisions(code, name_hu, name_ro, sort))," +
      "division:ob_divisions(code, name_hu, name_ro, sort)," +
      "group:ob_groups(label_hu, label_ro)"),
    supabase.from("post_descriptions").select("post_id, status, version"),
    supabase.from("person_capabilities").select("capability"),
    supabase.from("ob_post_holders").select("post_id, person:persons(user_id)").is("valid_to", null),
  ]);
  fail(postsQ.error); fail(descQ.error); fail(capsQ.error); fail(holdersQ.error);
  const caps = new Set(((capsQ.data as { capability: string }[]) ?? []).map(c => c.capability));
  const uid = session?.user?.id;
  const myPostIds = new Set(
    ((holdersQ.data as unknown as { post_id: string; person: { user_id: string | null } | null }[]) ?? [])
      .filter(h => h.person?.user_id && h.person.user_id === uid)
      .map(h => h.post_id));
  return {
    posts: (postsQ.data as unknown as PostMeta[]) ?? [],
    descs: (descQ.data as { post_id: string; status: DescStatus; version: number }[]) ?? [],
    canEdit: caps.has("posztleiras.szerkesztes") || caps.has("hr") || caps.has("admin"),
    myPostIds,
  };
}

export async function loadPostDetail(postId: string) {
  const [postQ, descQ, glossQ, capsQ] = await Promise.all([
    supabase.from("ob_posts").select(
      "id, name_hu, name_ro, evt_hu, evt_ro, lead_level, org_anchor," +
      "department:ob_departments(code, name_hu, name_ro, division:ob_divisions(code, name_hu, name_ro))," +
      "division:ob_divisions(code, name_hu, name_ro)," +
      "group:ob_groups(label_hu, label_ro)").eq("id", postId).maybeSingle(),
    supabase.from("post_descriptions").select("*").eq("post_id", postId)
      .order("version", { ascending: false }),
    supabase.from("glossary_terms").select("*")
      .or(`post_id.is.null,post_id.eq.${postId}`).order("term"),
    supabase.from("person_capabilities").select("capability"),
  ]);
  fail(postQ.error); fail(descQ.error); fail(glossQ.error); fail(capsQ.error);
  const caps = new Set(((capsQ.data as { capability: string }[]) ?? []).map(c => c.capability));
  return {
    post: (postQ.data as unknown as PostMeta | null),
    descs: (descQ.data as PostDescription[]) ?? [],
    terms: (glossQ.data as GlossaryTerm[]) ?? [],
    canEdit: caps.has("posztleiras.szerkesztes") || caps.has("hr") || caps.has("admin"),
  };
}

export async function saveDraft(postId: string, existingDraftId: string | null,
                                nextVersion: number, content_hu: string, content_ro: string) {
  if (existingDraftId) {
    const { error } = await supabase.from("post_descriptions")
      .update({ content_hu, content_ro: content_ro || null }).eq("id", existingDraftId);
    fail(error);
    return existingDraftId;
  }
  const { data, error } = await supabase.from("post_descriptions")
    .insert({ post_id: postId, version: nextVersion, status: "vazlat",
              content_hu, content_ro: content_ro || null })
    .select("id").single();
  fail(error);
  return (data as { id: string }).id;
}

export async function publishDraft(postId: string, draftId: string) {
  const { error: e1 } = await supabase.from("post_descriptions")
    .update({ status: "archiv" }).eq("post_id", postId).eq("status", "ervenyes");
  fail(e1);
  const { error: e2 } = await supabase.from("post_descriptions")
    .update({ status: "ervenyes", published_at: new Date().toISOString() }).eq("id", draftId);
  fail(e2);
}

export async function upsertTerm(v: {
  id?: string; term: string; def_hu: string; def_ro: string;
  example_hu: string; example_ro: string; post_id: string | null;
}) {
  const row = { term: v.term.trim(), def_hu: v.def_hu, def_ro: v.def_ro || null,
                example_hu: v.example_hu || null, example_ro: v.example_ro || null,
                post_id: v.post_id };
  if (v.id) { const { error } = await supabase.from("glossary_terms").update(row).eq("id", v.id); fail(error); }
  else { const { error } = await supabase.from("glossary_terms").insert(row); fail(error); }
}

export async function deleteTerm(id: string) {
  const { error } = await supabase.from("glossary_terms").delete().eq("id", id);
  fail(error);
}
