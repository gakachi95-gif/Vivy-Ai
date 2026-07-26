# Deploying vivy-ai-backend to Render (no local terminal needed)

## Step 1 — Get your Flutterwave keys
1. Log into your Flutterwave dashboard → Settings → API Keys
2. Copy your **Secret Key** (starts `sk_test_` while testing, `sk_live_` in production)
3. Under Settings → Webhooks, set:
   - **Webhook URL**: `https://YOUR-RENDER-URL.onrender.com/flutterwave-webhook` (you'll get this URL in Step 4, come back and set this after)
   - **Secret Hash**: type any random string, e.g. `vivy-ai-8f2k9d` — save it, you'll need it in Step 3

## Step 2 — Get your Firebase service account key
1. Firebase Console → Project Settings → Service Accounts
2. Click **Generate new private key** → downloads a `.json` file
3. Open that file in any text editor, select all, copy it
4. You'll paste this whole JSON as ONE environment variable in Step 3 (Render accepts multi-line/JSON values fine)

## Step 3 — Push this backend folder to GitHub (web only, no terminal)
1. Go to github.com → New repository → name it e.g. `vivy-ai-backend` → Create
2. On the new repo page, click **"uploading an existing file"**
3. Drag in `server.js`, `package.json`, `.gitignore` (skip `.env.example`, or include it — it has no real secrets)
4. Commit directly to the `main` branch

## Step 4 — Deploy on Render
1. Go to render.com → New → **Web Service**
2. Connect your GitHub account, select the `vivy-ai-backend` repo
3. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free is fine to start
4. Under **Environment**, add these variables:
   - `FLW_SECRET_KEY` = your Flutterwave secret key
   - `FLW_WEBHOOK_HASH` = the random string you chose in Step 1
   - `FIREBASE_SERVICE_ACCOUNT` = the full JSON you copied in Step 2 (paste as-is)
   - `ALLOWED_ORIGIN` = your GitHub Pages URL, e.g. `https://kachi95-gif.github.io`
5. Click **Create Web Service**. Render will build and deploy automatically — takes a few minutes.
6. Once live, you'll get a URL like `https://vivy-ai-backend.onrender.com`. Visit it — you should see `{"status":"ok","service":"vivy-ai-backend"}`

## Step 5 — Finish linking things up
1. Go back to Flutterwave → Webhooks → paste in `https://vivy-ai-backend.onrender.com/flutterwave-webhook`
2. In your Vivy AI frontend, set `FLW_CONFIG.verifyEndpoint` (in `firebase-config.js`) to:
   `https://vivy-ai-backend.onrender.com/verify-payment`
3. Push that frontend change to your GitHub Pages repo

## Notes
- **Render free tier sleeps after inactivity** — the first request after idle time can take ~30-50 seconds to wake up. Fine for testing; consider a paid instance before real launch so upgrades don't feel slow.
- Test with Flutterwave's test cards first (`sk_test_` key + their published test card numbers) before switching to `sk_live_`.
