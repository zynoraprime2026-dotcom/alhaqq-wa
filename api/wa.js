// Al-Haqq Digital — WhatsApp Assistant API
// One endpoint, three modes:
//   GET  ?hub.mode=subscribe&hub.verify_token=...  → Meta webhook verification
//   POST Meta webhook payload (entry/changes/messages) → auto-reply via Graph API
//   POST { dryRun: true, message: "..." } → demo mode: returns the reply without sending
//
// Env vars (set in Vercel → Settings → Environment Variables):
//   WHATSAPP_CLOUD_TOKEN  — permanent access token from Meta
//   WHATSAPP_PHONE_NUMBER_ID — phone number ID from WhatsApp Manager
//   VERIFY_TOKEN — any string you choose (default: alhaqq-demo-2026)
//   WHATSAPP_APP_SECRET — App secret from Meta app dashboard (enables signature checks)
//   OFFICE_WEBHOOK_URL — optional: Slack/Discord/Google Chat webhook to receive booking alerts
//   OFFICE_WHATSAPP — optional: office staff WhatsApp number (country code, no +) for booking alerts

import crypto from "crypto";

export const config = {
  api: { bodyParser: false } // we need the raw body to verify Meta's signature
};

const FAQ = {
  fees: "💳 *School & Programme Fees*\n\nPrimary (KG–P6): ₵450 per term\nJHS (JSS 1–3): ₵550 per term\n\nPayment via Mobile Money (MoMo) on *024XXXXXXX* or at the school office.\n\nType *menu* for more options.",
  admissions: "📝 *Admissions — How to Apply*\n\n1. Collect a form at the school office (Mon–Fri, 8am–3pm)\n2. Or apply online — ask us to send the link\n3. Bring: birth certificate, 2 passport photos, last report card\n\nTerms begin in January, May and September.\n\nType *menu* for more options.",
  events: "📣 *Upcoming Programmes*\n\n• Jumu'ah khutbah every Friday, 1:30pm\n• Arabic classes for adults — Saturdays, 10am\n• Monthly community cleanup — first Sunday\n\nType *menu* for more options.",
  donations: "🤲 *Support the Masjid*\n\nMobile Money (MoMo): *024XXXXXXX*\nBank: MASJID XXXX — a/c 1234567890\n\nEvery cedi goes to masjid upkeep and madrasa stipends. Jazakum Allahu khairan!\n\nType *menu* for more options."
};

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "alhaqq-demo-2026";
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || "";
const OFFICE_WEBHOOK_URL = process.env.OFFICE_WEBHOOK_URL || "";
const OFFICE_WHATSAPP = process.env.OFFICE_WHATSAPP || "";

function menu() {
  return "🕌 *As-salamu alaykum! Welcome to the Masjid & Madrasa Assistant*\n\nI can help you with:\n\n1️⃣ *Prayer times* — today's times in Accra\n2️⃣ *Fees* — school & programme fees\n3️⃣ *Admissions* — how to apply\n4️⃣ *Events* — upcoming programmes\n5️⃣ *Donations* — support the masjid\n6️⃣ *Book* — appointment with the imam or a teacher\n\nJust type a word like *prayer*, *fees*, or *book*.";
}

async function getPrayerTimes() {
  try {
    const res = await fetch(
      "https://api.aladhan.com/v1/timingsByCity?city=Accra&country=Ghana&method=3"
    );
    const data = await res.json();
    const t = data?.data?.timings;
    if (!t) throw new Error("no timings");
    return (
      "🕌 *Prayer Times — Accra (today)*\n\n" +
      "Fajr:     " + t.Fajr + "\n" +
      "Sunrise:  " + t.Sunrise + "\n" +
      "Dhuhr:    " + t.Dhuhr + "\n" +
      "Asr:      " + t.Asr + "\n" +
      "Maghrib:  " + t.Maghrib + "\n" +
      "Isha:     " + t.Isha + "\n\n" +
      "Times are for the Accra timezone. Type *menu* for more options."
    );
  } catch (e) {
    return "Sorry, I couldn't fetch prayer times right now. Please try again shortly. Type *menu* for other options.";
  }
}

function classify(text) {
  const s = text.toLowerCase();
  if (/(menu|help|start|hi|hello|salam|as-salam|assalam)/.test(s)) return "menu";
  if (/(book|appointment)/.test(s)) return "book";
  if (/(admission|admissions|apply|register|enroll)/.test(s)) return "admissions";
  if (/(event|program|khutbah|class)/.test(s)) return "events";
  if (/(donat|sadaqah|sadaqa|zakat|support)/.test(s)) return "donations";
  if (/(prayer|salah|salat|salaah|namaz|time)/.test(s)) return "prayer";
  if (/(fee|cost|price|pay)/.test(s)) return "fees";
  if (/(imam|teacher|meet)/.test(s)) return "book";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Booking delivery — makes sure the office actually SEES appointment requests
// ---------------------------------------------------------------------------
async function deliverBooking(from, text) {
  const alert =
    "📅 *New appointment request*\n\n" +
    "From: " + from + "\n" +
    "Message: " + text + "\n\n" +
    "Reply to the customer on WhatsApp to confirm, in shaa Allah.";

  // Always logged in Vercel function logs (searchable, nothing is lost)
  console.log("[BOOKING]", JSON.stringify({ from, text, at: new Date().toISOString() }));

  const results = [];

  // Option A: push to a chat webhook (Slack / Discord / Google Chat) — most reliable
  if (OFFICE_WEBHOOK_URL) {
    try {
      const r = await fetch(OFFICE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: alert })
      });
      results.push("webhook:" + r.status);
    } catch (e) {
      results.push("webhook:error");
    }
  }

  // Option B: WhatsApp the office staff directly.
  // NOTE: Meta only delivers business-initiated messages inside a 24h window
  // (or with an approved template). Keep OFFICE_WEBHOOK_URL as the reliable path.
  if (OFFICE_WHATSAPP) {
    try {
      const r = await sendWhatsApp(OFFICE_WHATSAPP, alert);
      results.push("whatsapp:" + r.status);
    } catch (e) {
      results.push("whatsapp:error");
    }
  }

  return results;
}

async function generateReply(text, from) {
  const intent = classify(text);

  if (intent === "prayer") return await getPrayerTimes();
  if (intent === "menu") return menu();
  if (intent === "fees") return FAQ.fees;
  if (intent === "admissions") return FAQ.admissions;
  if (intent === "events") return FAQ.events;
  if (intent === "donations") return FAQ.donations;

  if (intent === "book") {
    if (text.length > 25) {
      await deliverBooking(from, text);
      return "✅ *Appointment request received!*\n\nOur office has been notified and will confirm your appointment by WhatsApp within a few hours, in shaa Allah.\n\nType *menu* for more options.";
    }
    return "📅 *Book an Appointment*\n\nTo book with the imam or a teacher, send:\n\n*Book* — your name — what you need — preferred day\n\nExample: *Book — Musah — marriage counselling — Friday*\n\nWe'll confirm within a few hours.";
  }

  return "I didn't quite understand that. " + menu();
}

async function sendWhatsApp(to, reply) {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { status: "not_connected" };

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: reply }
    })
  });
  return { status: "replied", graph_status: res.status };
}

// ---------------------------------------------------------------------------
// Raw body + Meta signature verification
// ---------------------------------------------------------------------------
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function signatureValid(rawBody, header) {
  if (!APP_SECRET) return true; // no secret configured → skip (demo deployments)
  if (!header || !header.startsWith("sha256=")) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  // Enable CORS so any site can use the demo mode
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Meta webhook verification (GET)
  if (req.method === "GET") {
    const q = req.query || {};
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === VERIFY_TOKEN) {
      return res.status(200).send(q["hub.challenge"] || "");
    }
    return res.status(403).send("Forbidden");
  }

  // POST — read the raw body ourselves (bodyParser is off for signature checks)
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ status: "bad_body" });
  }

  if (APP_SECRET && !signatureValid(rawBody, req.headers["x-hub-signature-256"])) {
    return res.status(401).json({ status: "invalid_signature" });
  }

  let body = {};
  try {
    body = JSON.parse(rawBody.toString("utf8") || "{}");
  } catch (e) {
    body = {};
  }

  // DEMO MODE — returns the reply instead of sending it
  if (body.dryRun) {
    const reply = await generateReply(body.message || "hello", body.from || "demo");
    return res.status(200).json({ mode: "demo", intent: classify(body.message || ""), reply });
  }

  // REAL MODE — Meta webhook payload
  try {
    const entry = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (!msg || msg.type !== "text") return res.status(200).json({ status: "ignored" });

    const from = msg.from;
    const text = (msg.text?.body || "").trim();
    const reply = await generateReply(text, from);
    const result = await sendWhatsApp(from, reply);
    return res.status(200).json(result.status === "replied" ? result : { status: "not_connected", would_reply: reply });
  } catch (e) {
    // Never 500 on Meta — it retries failed webhooks
    return res.status(200).json({ status: "error", message: String(e && e.message ? e.message : e) });
  }
}
