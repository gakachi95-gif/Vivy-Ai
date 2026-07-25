# Vivy AI — Personal AI Assistant Web App

A mobile-first, premium-purple, glassmorphic AI personal assistant. Pure **HTML + CSS + JavaScript** — no React, no Vue, no build tools, no Node.js required. Runs directly on **GitHub Pages**.

## ✨ Features

- **Auth**: Email/password + Google Sign-In, Forgot Password, Remember Me, secure logout (Firebase Authentication)
- **Dashboard**: profile, plan badge, daily usage bar, 8 quick-action cards
- **AI Chat**: ChatGPT-style UI, markdown rendering, typing animation, copy/regenerate/delete, search, pin, favorite, share, export to TXT/PDF
- **AI Writer**: 13 content formats (blog, email, story, essay, social posts, YouTube metadata, business plan...)
- **AI Summarizer**: short summary + bullet points + key ideas
- **AI Translator**: multi-language, auto-detect source, copy translation
- **AI Brainstorm**: 8 idea categories
- **AI Image Analysis**: upload, describe / OCR / Q&A / extract info, stored in Firebase Storage
- **Chat History**: rename, delete, search, favorite, pin — across all tools
- **Notifications**: success / error / warning / info toasts
- **Settings**: dark/light mode, language, clear history, delete account, legal pages
- **Monetization-ready**: free daily limit + ad banner, premium plan flag, upgrade hook
- **PWA-ready**: manifest.json + service-worker.js, installable, offline app shell
- **Voice-ready architecture**: `voice.js` scaffolds Speech-to-Text / Text-to-Speech for a future release

## 🚀 Getting Started

1. **Create a Firebase project** at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication** → Email/Password + Google providers
3. Enable **Firestore Database** (start in production mode) and **Storage**
4. Copy your Firebase config into `firebase-config.js` (replace the placeholder values)
5. Deploy Firestore security rules (see below)
6. Push this folder to a GitHub repository and enable **GitHub Pages** (Settings → Pages → deploy from branch, root)
7. Visit your GitHub Pages URL — that's it, no build step needed!

### Recommended Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      match /conversations/{convoId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
      match /history/{itemId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

### Recommended Storage Rules

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 🤖 Connecting a Real AI Provider

For security, this app **never** calls an AI provider directly from the browser with a secret key (that would expose it to every visitor). Instead:

1. Deploy a small serverless function (Firebase Cloud Function, Cloudflare Worker, Vercel Edge Function...) that holds your AI provider's API key and forwards `{ task, prompt, meta, imageBase64 }` to it.
2. Set `AI_CONFIG.endpoint` in `firebase-config.js` to that function's URL.
3. Set `AI_CONFIG.enabled = true`.

Until you do this, every AI feature runs in a fully-functional **offline demo mode** (see `VivyAI._offlineFallback` in `utils.js`) so the whole app is testable and demoable immediately.

## 📁 File Structure

```
index.html            Splash screen / auth-state router
login.html             Sign in
register.html          Sign up
dashboard.html          Main dashboard
chat.html + chat.js      AI Chat
writer.html + writer.js   AI Writer
summarizer.html          AI Summarizer
translator.html          AI Translator
brainstorm.html          AI Brainstorm
image-analysis.html       AI Image Analysis
history.html            Chat/AI History
settings.html            Settings
voice.js               Voice assistant architecture (not yet wired in)
firebase-config.js        Firebase + AI provider configuration
auth.js                Authentication logic
utils.js                Shared helpers (notifications, markdown, AI wrapper, theming, auth guard)
styles.css              Global stylesheet (purple premium theme)
service-worker.js         PWA offline caching
manifest.json            PWA manifest
icons/                 App icons (192px, 512px)
```

## 📱 Converting to an Android APK Later

This app is a standards-compliant PWA, so you have two easy paths later:

- **Trusted Web Activity (TWA)** via [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) or [PWABuilder](https://www.pwabuilder.com) — wraps the deployed PWA URL into a real installable APK/AAB for the Play Store.
- **Capacitor** (Ionic) — `npx cap init` + `npx cap add android` pointing at this static folder, for a more native-feeling wrapper with plugin access (camera, notifications, etc.).

Neither requires rewriting any of this code — just point the tool at your deployed GitHub Pages URL (or bundle these static files directly).

## 🎨 Design

Deep purple gradients, glassmorphism cards, Material Icons, Poppins typography, skeleton loading states, bottom navigation on mobile, sidebar navigation on desktop (≥900px), full dark/light theme support.

## 🔒 Security Notes

- All protected pages call `requireAuth()` and redirect unauthenticated users to `login.html`.
- All user-generated text is sanitized before being injected into the DOM (`sanitizeInput`).
- Firestore/Storage rules (above) scope every read/write to the signed-in user's own `uid`.
- No AI provider API key is ever present in client-side code.
