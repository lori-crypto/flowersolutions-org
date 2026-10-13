"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, REMEMBER_KEY } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";
import { fetchMyCaps, routeForCaps } from "@/lib/TopNav";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();

  // Ha már be vagy jelentkezve (pl. vissza-gesztussal kerültél ide),
  // azonnal az első elérhető modulra irányítunk.
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const caps = await fetchMyCaps();
        router.replace(routeForCaps(caps) ?? "/tabla");
      }
    });
  }, [router]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setOk("");
    try { localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0"); } catch {}
    // telefonszámmal is lehet: ilyenkor megkeressük a hozzá tartozó emailt
    let loginEmail = email.trim();
    if (!loginEmail.includes("@")) {
      const { data: found } = await supabase.rpc("app_login_email_for_phone", { p_phone: loginEmail });
      if (!found) { setBusy(false); setErr(t("login_error")); return; }
      loginEmail = found as string;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    setBusy(false);
    if (error) { setErr(t("login_error")); return; }
    const caps = await fetchMyCaps();
    router.replace(routeForCaps(caps) ?? "/tabla");
  }

  async function forgot() {
    if (!email) { setErr(t("email") + "?"); return; }
    setErr(""); setOk("");
    await supabase.auth.resetPasswordForEmail(email);
    setOk(t("reset_sent"));
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={signIn}>
        <h1>FS Org</h1>
        <div className="sub">Flower Solutions — {t("login_title")}</div>
        <label>{t("login_id")}</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
               autoComplete="email" required />
        <label>{t("password")}</label>
        <div className="pw-wrap">
          <input type={showPw ? "text" : "password"} value={password}
                 onChange={e => setPassword(e.target.value)}
                 autoComplete="current-password" required />
          <button type="button" className="pw-eye" aria-label={t("show_pw")}
                  title={t("show_pw")} onClick={() => setShowPw(v => !v)}>
            {showPw ? "🙈" : "👁"}
          </button>
        </div>
        <label className="remember-row">
          <input type="checkbox" checked={remember}
                 onChange={e => setRemember(e.target.checked)} />
          {t("remember_me")}
        </label>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? t("signing_in") : t("sign_in")}
        </button>
        {err && <div className="err">{err}</div>}
        {ok && <div className="ok">{ok}</div>}
        <button type="button" className="forgot" onClick={forgot}>{t("forgot")}</button>
      </form>
    </div>
  );
}
