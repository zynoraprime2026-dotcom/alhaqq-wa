# Al-Haqq WA — Masjid WhatsApp Assistant

WhatsApp automation for masjids & madrasas, by Al-Haqq Digital.

## What's inside

- `index.html` — live demo page (WhatsApp-style chat in the browser)
- `api/wa.js` — the reply brain + Meta WhatsApp Cloud API webhook (Vercel serverless function)

## Deploy (same flow as the Al-Haqq site)

1. Import this repo into Vercel → you get a URL like `https://alhaqq-wa.vercel.app`
2. Open the URL — the demo chat works immediately (demo mode, no WhatsApp connection needed)

## Connect a real WhatsApp number

1. Create a Meta Business account + WhatsApp app (developers.facebook.com)
2. Add a phone number (test number is free; real number needs a fresh SIM)
3. In Vercel → Settings → Environment Variables, add:
   - `WHATSAPP_CLOUD_TOKEN` — permanent access token
   - `WHATSAPP_PHONE_NUMBER_ID` — phone number ID
   - `VERIFY_TOKEN` — keep default `alhaqq-demo-2026` or change it
4. In Meta → WhatsApp Manager → Configuration:
   - Callback URL: `https://YOUR-DEPLOYMENT.vercel.app/api/wa`
   - Verify token: `alhaqq-demo-2026`
5. Send a WhatsApp message to the number — the assistant replies automatically.

## Customise for a client

All replies live in `api/wa.js` — the FAQ object (fees, admissions, events, donations)
and the menu. Replace the placeholder MoMo numbers and times with the client's real
information before handover.
