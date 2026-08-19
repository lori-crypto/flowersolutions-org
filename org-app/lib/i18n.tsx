"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Lang = "hu" | "ro";

const DICT: Record<string, { hu: string; ro: string }> = {
  login_title:      { hu: "Bejelentkezés", ro: "Autentificare" },
  email:            { hu: "Email", ro: "Email" },
  password:         { hu: "Jelszó", ro: "Parolă" },
  sign_in:          { hu: "Belépés", ro: "Intră" },
  signing_in:       { hu: "Belépés…", ro: "Se autentifică…" },
  login_error:      { hu: "Hibás email vagy jelszó.", ro: "Email sau parolă greșită." },
  forgot:           { hu: "Elfelejtett jelszó", ro: "Am uitat parola" },
  remember_me:      { hu: "Maradjak bejelentkezve", ro: "Ține-mă autentificat" },
  show_pw:          { hu: "Jelszó megjelenítése", ro: "Afișează parola" },
  reset_sent:       { hu: "Ha létezik a fiók, elküldtük a visszaállító emailt.", ro: "Dacă contul există, am trimis emailul de resetare." },
  sign_out:         { hu: "Kijelentkezés", ro: "Deconectare" },
  loading:          { hu: "Betöltés…", ro: "Se încarcă…" },
  org_board:        { hu: "Szervezési tábla", ro: "Organigrama" },
  edit_mode:        { hu: "Szerkesztő mód", ro: "Mod editare" },
  edit_mode_on:     { hu: "Szerkesztő mód: BE", ro: "Mod editare: PORNIT" },
  edit_hint:        { hu: "✏️ Szerkesztő mód: a ✎ ikonokkal módosíthatsz, a ＋ gombokkal bővíthetsz, a ✕-szel törölhetsz. Minden változás naplózódik.", ro: "✏️ Mod editare: modifică cu ✎, adaugă cu ＋, șterge cu ✕. Toate modificările sunt înregistrate." },
  ceo:              { hu: "Ügyvezető", ro: "Director general" },
  division:         { hu: "OSZTÁLY", ro: "DIVIZIA" },
  division_leader:  { hu: "osztályvezető", ro: "șef de divizie" },
  dept_leader:      { hu: "alosztályvezető", ro: "șef de departament" },
  vacant:           { hu: "betöltetlen", ro: "neocupat" },
  post_evt:         { hu: "Poszt EVT", ro: "PFV post" },
  division_evt:     { hu: "AZ OSZTÁLY EVT-je", ro: "PFV-ul DIVIZIEI" },
  dept_evt:         { hu: "EVT", ro: "PFV" },
  org_evt:          { hu: "A SZERVEZET EVT-je", ro: "PFV-ul ORGANIZAȚIEI" },
  post_desc:        { hu: "Posztleírás", ro: "Fișa postului" },
  lead_tag:         { hu: "VEZ", ro: "ȘEF" },
  add_post:         { hu: "＋ Poszt", ro: "＋ Post" },
  add_dept:         { hu: "＋ Alosztály", ro: "＋ Departament" },
  add_division:     { hu: "＋ Új osztály", ro: "＋ Divizie nouă" },
  add_division_sub: { hu: "(pl. 4A / 4B bontás)", ro: "(ex. divizare 4A / 4B)" },
  save:             { hu: "Mentés", ro: "Salvează" },
  cancel:           { hu: "Mégse", ro: "Anulează" },
  delete:           { hu: "Törlés", ro: "Șterge" },
  confirm_del_div:  { hu: "Biztosan törlöd az osztályt az összes alosztályával és posztjával?", ro: "Sigur ștergi divizia cu toate departamentele și posturile?" },
  confirm_del_dept: { hu: "Törlöd az alosztályt a posztjaival együtt?", ro: "Ștergi departamentul cu posturile lui?" },
  confirm_del_post: { hu: "Törlöd a posztot?", ro: "Ștergi postul?" },
  f_code:           { hu: "Sorszám / jelzés", ro: "Număr / cod" },
  f_name_hu:        { hu: "Név (magyar)", ro: "Denumire (maghiară)" },
  f_name_ro:        { hu: "Név (román)", ro: "Denumire (română)" },
  f_evt_hu:         { hu: "EVT (magyar)", ro: "PFV (maghiară)" },
  f_evt_ro:         { hu: "EVT (román)", ro: "PFV (română)" },
  f_color:          { hu: "Szín", ro: "Culoare" },
  f_group_b:        { hu: "A B-csoporthoz tartozzon", ro: "Să aparțină grupei B" },
  f_holders:        { hu: "Betöltő személyek", ro: "Persoane pe post" },
  f_lead_post:      { hu: "Vezetői poszt", ro: "Post de conducere" },
  f_new_person:     { hu: "＋ Új személy neve…", ro: "＋ Nume persoană nouă…" },
  edit_division:    { hu: "Osztály szerkesztése", ro: "Editare divizie" },
  new_division:     { hu: "Új osztály", ro: "Divizie nouă" },
  edit_dept:        { hu: "Alosztály szerkesztése", ro: "Editare departament" },
  new_dept:         { hu: "Új alosztály", ro: "Departament nou" },
  edit_post:        { hu: "Poszt szerkesztése", ro: "Editare post" },
  new_post:         { hu: "Új poszt", ro: "Post nou" },
  edit_org_evt:     { hu: "A szervezet EVT-je", ro: "PFV-ul organizației" },
  err_save:         { hu: "A mentés nem sikerült — nincs jogosultságod, vagy hálózati hiba történt.", ro: "Salvarea a eșuat — nu ai permisiune sau a apărut o eroare de rețea." },
  no_translation:   { hu: "nincs román fordítás", ro: "lipsește traducerea" },
};

type I18n = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  pick: (hu: string | null | undefined, ro: string | null | undefined) => string;
};

const Ctx = createContext<I18n>({
  lang: "hu", setLang: () => {}, t: (k) => k, pick: (hu) => hu || "",
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("hu");
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("lang") : null;
    if (saved === "hu" || saved === "ro") setLangState(saved);
  }, []);
  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem("lang", l); } catch {} };
  const t = (key: string) => DICT[key]?.[lang] ?? key;
  const pick = (hu: string | null | undefined, ro: string | null | undefined) =>
    lang === "ro" ? (ro || hu || "") : (hu || ro || "");
  return <Ctx.Provider value={{ lang, setLang, t, pick }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
