"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setOk("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setErr(t("login_error")); return; }
    router.push("/tabla");
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
        <label>{t("email")}</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
               autoComplete="email" required />
        <label>{t("password")}</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
               autoComplete="current-password" required />
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
