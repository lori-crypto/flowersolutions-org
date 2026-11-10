"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";
import { fetchMyCaps, routeForCaps } from "@/lib/TopNav";

/**
 * Új jelszó beállítása az emailben kapott visszaállító linkről.
 * A Supabase a link megnyitása után ide irányít:
 *  - sikeres esetben  #access_token=…&type=recovery  → a kliens munkamenetet épít,
 *    és a PASSWORD_RECOVERY esemény után megjelenik az új-jelszó űrlap;
 *  - hibás/lejárt link esetén  #error=…&error_code=otp_expired  → érthető üzenet
 *    és egy gomb, amivel új linket lehet kérni.
 * Az útvonal /login alatt van, így a SessionGuard nem nyúl bele.
 */
export default function UjJelszoPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [phase, setPhase] = useState<"varakozas" | "urlap" | "hiba" | "kesz">("varakozas");
  const [linkErr, setLinkErr] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    // 1) hiba a linkben (lejárt / már felhasznált)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const q = new URLSearchParams(window.location.search);
    const code = hash.get("error_code") || q.get("error_code");
    if (hash.get("error") || q.get("error")) {
      setLinkErr(code === "otp_expired" ? t("pw_link_expired") : (hash.get("error_description") || q.get("error_description") || t("pw_link_invalid")));
      setPhase("hiba");
      return;
    }
    // 2) a Supabase kliens feldolgozza a #access_token-t → PASSWORD_RECOVERY / SIGNED_IN
    let settled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (settled) return;
      if (event === "PASSWORD_RECOVERY" || (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION"))) {
        settled = true; setPhase("urlap");
      }
    });
    // ha már van munkamenet (pl. frissítés után), az űrlap jöhet
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!settled && session) { settled = true; setPhase("urlap"); }
    });
    // 3) ha 8 mp alatt sem lett munkamenet, a link nem volt használható
    const timer = setTimeout(() => {
      if (!settled) { settled = true; setLinkErr(t("pw_link_invalid")); setPhase("hiba"); }
    }, 8000);
    return () => { clearTimeout(timer); sub.subscription.unsubscribe(); };
  }, [t]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (pw1.length < 8) { setErr(t("pw_too_short")); return; }
    if (pw1 !== pw2) { setErr(t("pw_mismatch")); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPhase("kesz");
    const caps = await fetchMyCaps();
    setTimeout(() => router.replace(routeForCaps(caps) ?? "/tabla"), 1200);
  }

  async function resend() {
    if (!email.trim()) { setErr(t("email") + "?"); return; }
    setErr("");
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login/uj-jelszo`,
    });
    setSent(true);
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={save}>
        <h1>FS Org</h1>
        <div className="sub">Flower Solutions — {t("pw_new_title")}</div>

        {phase === "varakozas" && <div className="sub">{t("pw_checking")}</div>}

        {phase === "hiba" && (<>
          <div className="err" style={{ marginBottom: 12 }}>{linkErr}</div>
          <label>{t("email")}</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          <button className="btn" type="button" onClick={resend} disabled={sent}>
            {sent ? t("reset_sent") : t("pw_resend")}
          </button>
          <button type="button" className="forgot" onClick={() => router.replace("/login")}>← {t("sign_in")}</button>
        </>)}

        {phase === "urlap" && (<>
          <label>{t("pw_new")}</label>
          <div className="pw-wrap">
            <input type={show ? "text" : "password"} value={pw1} onChange={e => setPw1(e.target.value)}
                   autoComplete="new-password" required minLength={8} />
            <button type="button" className="pw-eye" aria-label={t("show_pw")} title={t("show_pw")}
                    onClick={() => setShow(v => !v)}>{show ? "🙈" : "👁"}</button>
          </div>
          <label>{t("pw_new_again")}</label>
          <input type={show ? "text" : "password"} value={pw2} onChange={e => setPw2(e.target.value)}
                 autoComplete="new-password" required minLength={8} />
          <button className="btn" type="submit" disabled={busy}>{busy ? "…" : t("pw_save")}</button>
          <div className="sub" style={{ marginTop: 10 }}>{t("pw_hint")}</div>
        </>)}

        {phase === "kesz" && <div className="ok">{t("pw_saved")}</div>}

        {err && <div className="err">{err}</div>}
      </form>
    </div>
  );
}
