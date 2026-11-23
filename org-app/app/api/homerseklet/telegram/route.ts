import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Telegram webhook a hőmérséklet-figyelő botnak.
//  • „✅ Láttam" gomb → a riasztás nyugtázva, emlékeztető nem jön többet
//  • /allapot → minden szonda aktuális értéke
//  • /start → kiírja a csoport azonosítóját (a beállításhoz kell)
// A bot-kulcs és a webhook-titok a temp_config táblában van (sql/38).
// A Telegram minden hívásnál elküldi a titkot az X-Telegram-Bot-Api-Secret-Token fejlécben.

export const dynamic = "force-dynamic";

type Cfg = { bot_token: string | null; chat_id: string | null; webhook_secret: string; leave_chat_id?: string | null };

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

async function tg(token: string, method: string, body: unknown) {
  await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => undefined);
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin();
  const { data: cfg } = await db.from("temp_config")
    .select("*").eq("id", 1).maybeSingle<Cfg>();
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!cfg?.bot_token || !same(given, cfg.webhook_secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const token = cfg.bot_token;
  const u = await req.json().catch(() => null);
  if (!u) return NextResponse.json({ ok: true });

  // ── Gombnyomás ────────────────────────────────────────────
  const cq = u.callback_query;
  if (cq) {
    const chatId = String(cq.message?.chat?.id ?? "");

    // szabadság-jóváhagyás (SQL 42): lv:ok:<csoport> / lv:no:<csoport>
    const lv = /^lv:(ok|no):([0-9a-f-]{36})$/.exec(String(cq.data ?? ""));
    if (lv) {
      if (!cfg.leave_chat_id || chatId !== cfg.leave_chat_id) {
        await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Ehhez nincs jogod." });
        return NextResponse.json({ ok: true });
      }
      const ok = lv[1] === "ok";
      const who = [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(" ") || "Telegram";
      const { data: n, error } = await db.rpc("app_leave_decide_core", { p_group: lv[2], p_ok: ok, p_by: who });
      const done = !error && Number(n) > 0;
      await tg(token, "answerCallbackQuery", {
        callback_query_id: cq.id,
        text: error ? "Hiba: " + error.message : done ? (ok ? "Jóváhagyva ✅" : "Elutasítva ❌") : "Erről már döntöttek (vagy törölték).",
      });
      if (cq.message?.message_id) {
        await tg(token, "editMessageText", {
          chat_id: chatId, message_id: cq.message.message_id, parse_mode: "HTML",
          text: String(cq.message.text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/^🗓 Jóváhagyásra vár.*\n?/, "🗓 ") + "\n\n" +
            (done ? (ok ? "✅ <b>Jóváhagyva</b>" : "❌ <b>Elutasítva</b>") : "ℹ️ Már döntöttek róla / törölték."),
          reply_markup: { inline_keyboard: [] },
        });
      }
      return NextResponse.json({ ok: true });
    }

    const m = /^ack:(\d+)$/.exec(String(cq.data ?? ""));
    if (!m || chatId !== cfg.chat_id) {
      await tg(token, "answerCallbackQuery", { callback_query_id: cq.id });
      return NextResponse.json({ ok: true });
    }
    const who = [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(" ") || "valaki";
    const { data: rows } = await db.from("temp_alerts")
      .update({ ack_at: new Date().toISOString(), ack_by: who })
      .eq("id", Number(m[1])).is("ack_at", null).select("id");
    const fresh = (rows?.length ?? 0) > 0;
    await tg(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: fresh ? "Nyugtázva — emlékeztető nem jön többet." : "Ezt már nyugtázták.",
    });
    if (cq.message?.message_id) {
      await tg(token, "editMessageReplyMarkup", {
        chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] },
      });
      if (fresh) {
        await tg(token, "sendMessage", {
          chat_id: chatId, reply_to_message_id: cq.message.message_id,
          text: `👀 ${who} látta.`,
        });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ── Parancsok ─────────────────────────────────────────────
  const msg = u.message;
  const text = String(msg?.text ?? "").trim();
  const chatId = String(msg?.chat?.id ?? "");
  if (!msg || !text.startsWith("/")) return NextResponse.json({ ok: true });
  const cmd = text.split(/[\s@]/)[0].toLowerCase();

  if (cmd === "/start" || cmd === "/id") {
    await tg(token, "sendMessage", {
      chat_id: chatId,
      text: `Ennek a beszélgetésnek az azonosítója: ${chatId}` +
        (chatId === cfg.chat_id ? "\n✅ Ide érkeznek a riasztások." : "") +
        (chatId === cfg.leave_chat_id ? "\n✅ Ide érkeznek a szabadság-jóváhagyások." : ""),
    });
  } else if ((cmd === "/allapot" || cmd === "/status") && chatId === cfg.chat_id) {
    const { data: txt } = await db.rpc("temp_summary_text", { p_title: "🌡 <b>Jelenlegi állapot</b>" });
    await tg(token, "sendMessage", {
      chat_id: chatId, text: String(txt ?? "Nincs adat."), parse_mode: "HTML",
    });
  }
  return NextResponse.json({ ok: true });
}

// Egyszeri beállítás: a webhook regisztrálása a Telegramnál.
//   https://org.flowersolutions.ro/api/homerseklet/telegram?setup=1&secret=<CRON_SECRET>
const clean = (v?: string) => (v ?? "").trim().replace(/^["']+|["']+$/g, "");

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const secret = clean(process.env.CRON_SECRET);
  if (!secret || !same(sp.get("secret") ?? "", secret) || sp.get("setup") !== "1") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data: cfg } = await db.from("temp_config")
    .select("bot_token, chat_id, webhook_secret").eq("id", 1).maybeSingle<Cfg>();
  if (!cfg?.bot_token) {
    return NextResponse.json({ error: "Előbb add meg a bot_token-t a temp_config táblában." }, { status: 400 });
  }
  const url = `${req.nextUrl.origin}/api/homerseklet/telegram`;
  const r = await fetch(`https://api.telegram.org/bot${cfg.bot_token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url, secret_token: cfg.webhook_secret,
      allowed_updates: ["message", "callback_query"], drop_pending_updates: true,
    }),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  await fetch(`https://api.telegram.org/bot${cfg.bot_token}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands: [
      { command: "allapot", description: "Minden szonda aktuális értéke" },
      { command: "id", description: "A beszélgetés azonosítója" },
    ] }),
    cache: "no-store",
  }).catch(() => undefined);
  return NextResponse.json({ webhook: url, telegram: j, chat_id_set: !!cfg.chat_id });
}
