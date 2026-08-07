/* ==========================================================================
   services/firestore.js
   Single place that owns the Firebase Admin SDK instance and every
   Firestore read/write the backend needs — user profiles, daily AI usage
   tracking, plan upgrades, and the pricing configuration (used by both the
   AI routes and the Flutterwave payment routes).

   ------------------------------------------------------------------------
   CURRENCY ARCHITECTURE (single source of truth)
   ------------------------------------------------------------------------
   Vivy AI prices premium plans and credit packs in BOTH USD and NGN at the
   same time — it never converts one to the other with a hard-coded
   exchange rate. Every price lives in this shape:

     premiumMonthly: { USD: 9.99, NGN: 15000 }
     premiumYearly:  { USD: 79,   NGN: 120000 }
     creditPacks: [
       { id: "pack_500", credits: 500, price: { USD: 4.99, NGN: 7500 } },
       ...
     ]

   `currency` on the config is only the *default/global display* currency
   (what the frontend shows before the user picks one) — it never limits
   which currencies are accepted at checkout. Every payment explicitly
   carries its own currency end-to-end: the checkout call, the Flutterwave
   transaction, and the server-side verification all key off the SAME
   currency, and a mismatch is rejected (see routes/payment.js).

   getPricingConfig() is also the single place that normalizes legacy
   Firestore documents (old flat premiumMonthlyNGN / premiumMonthlyUSD /
   priceNGN / priceUSD fields) into this shape, so older data never crashes
   the app — see normalizePricingDoc() below. It also returns the old flat
   field names alongside the new nested ones, so any frontend code that
   hasn't been migrated yet keeps working during the transition.
   ========================================================================== */

const admin = require("firebase-admin");

// ---- Initialize Firebase Admin exactly once ----
if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable is missing.");
  }
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const FREE_DAILY_MESSAGES = parseInt(process.env.FREE_DAILY_MESSAGES || "20", 10);
const PREMIUM_DAILY_MESSAGES = parseInt(process.env.PREMIUM_DAILY_MESSAGES || "1000", 10);
const STARTER_CREDITS = parseInt(process.env.STARTER_CREDITS || "200", 10);

/** The only currencies Vivy AI accepts money in. Add here first if that ever changes. */
const SUPPORTED_CURRENCIES = ["USD", "NGN"];

/**
 * Default credit costs, free-plan limits, and pricing. Stored in Firestore
 * at config/pricing so the Admin Dashboard can edit them live without a
 * redeploy — these constants are only the fallback used the very first
 * time the app runs, before that document exists.
 */
const DEFAULT_PRICING = {
  costs: {
    generateCaption: 5,
    generateImage: 15,
    generateBlog: 25,
    analyzeMarketing: 10,
    generateCampaign: 50, // per campaign, charged once per generation batch call
    autopilotCampaign: 100,
    growthCoach: 10
  },
  freePlanLimits: {
    maxCampaigns: 3,
    maxConnectedAccounts: 1,
    autopilotEnabled: false,
    autoPublishEnabled: false,
    analyticsEnabled: false
  },
  // Global/default display currency. Does NOT restrict checkout — both
  // currencies are always accepted; this only picks what shows first.
  currency: "USD",
  creditPacks: [
    { id: "pack_500", credits: 500, price: { USD: 4.99, NGN: 7500 } },
    { id: "pack_1000", credits: 1000, price: { USD: 8.99, NGN: 13500 } },
    { id: "pack_5000", credits: 5000, price: { USD: 34.99, NGN: 52500 } },
    { id: "pack_10000", credits: 10000, price: { USD: 59.99, NGN: 90000 } }
  ],
  premiumMonthly: { USD: 9.99, NGN: 15000 },
  premiumYearly: { USD: 79, NGN: 120000 },
  referralMilestones: [
    { count: 5, rewardType: "credits", amount: 200 },
    { count: 50, rewardType: "premiumDays", amount: 30 }
  ]
};

/**
 * Turns a legacy flat field pair (e.g. premiumMonthlyUSD / premiumMonthlyNGN)
 * into the new { USD, NGN } shape, falling back to defaults for whichever
 * currency is missing. Never throws on missing/partial data.
 */
function normalizeMoneyPair(stored, flatUsdKey, flatNgnKey, nestedKey, fallback) {
  const nested = stored && stored[nestedKey];
  const flatUsd = stored && stored[flatUsdKey];
  const flatNgn = stored && stored[flatNgnKey];

  return {
    USD:
      (nested && nested.USD !== undefined ? nested.USD : undefined) ??
      flatUsd ??
      fallback.USD,
    NGN:
      (nested && nested.NGN !== undefined ? nested.NGN : undefined) ??
      flatNgn ??
      fallback.NGN
  };
}

/**
 * Normalizes a single credit pack, whether it's already in the new
 * { price: { USD, NGN } } shape or the legacy { priceUSD } / { priceNGN }
 * shape (or, worse, only one of those from a half-migrated edit).
 */
function normalizeCreditPack(pack, fallback) {
  const price = {
    USD:
      (pack.price && pack.price.USD !== undefined ? pack.price.USD : undefined) ??
      pack.priceUSD ??
      (fallback ? fallback.price.USD : 0),
    NGN:
      (pack.price && pack.price.NGN !== undefined ? pack.price.NGN : undefined) ??
      pack.priceNGN ??
      (fallback ? fallback.price.NGN : 0)
  };

  return {
    id: pack.id,
    credits: pack.credits,
    price,
    // Legacy flat aliases kept temporarily so any not-yet-updated frontend
    // code reading p.priceUSD / p.priceNGN directly keeps working.
    priceUSD: price.USD,
    priceNGN: price.NGN
  };
}

/**
 * Normalizes a raw Firestore pricing document (which may be brand new,
 * fully migrated, fully legacy, or a half-edited mix of both) into the
 * single canonical shape the rest of the app relies on. This is the ONE
 * place backward-compatibility for old NGN-only pricing docs lives —
 * idempotent and safe to run on every read.
 */
function normalizePricingDoc(stored) {
  stored = stored || {};

  const premiumMonthly = normalizeMoneyPair(
    stored,
    "premiumMonthlyUSD",
    "premiumMonthlyNGN",
    "premiumMonthly",
    DEFAULT_PRICING.premiumMonthly
  );
  const premiumYearly = normalizeMoneyPair(
    stored,
    "premiumYearlyUSD",
    "premiumYearlyNGN",
    "premiumYearly",
    DEFAULT_PRICING.premiumYearly
  );

  const rawPacks =
    Array.isArray(stored.creditPacks) && stored.creditPacks.length > 0
      ? stored.creditPacks
      : DEFAULT_PRICING.creditPacks;

  const creditPacks = rawPacks.map((pack) => {
    const fallback = DEFAULT_PRICING.creditPacks.find((p) => p.id === pack.id);
    return normalizeCreditPack(pack, fallback);
  });

  const currency = SUPPORTED_CURRENCIES.includes(stored.currency)
    ? stored.currency
    : DEFAULT_PRICING.currency;

  return {
    costs: { ...DEFAULT_PRICING.costs, ...stored.costs },
    freePlanLimits: { ...DEFAULT_PRICING.freePlanLimits, ...stored.freePlanLimits },
    currency,
    creditPacks,
    premiumMonthly,
    premiumYearly,
    referralMilestones: stored.referralMilestones || DEFAULT_PRICING.referralMilestones,

    // ---- Legacy flat aliases (temporary, for frontend still mid-migration) ----
    premiumMonthlyUSD: premiumMonthly.USD,
    premiumMonthlyNGN: premiumMonthly.NGN,
    premiumYearlyUSD: premiumYearly.USD,
    premiumYearlyNGN: premiumYearly.NGN
  };
}

/** Fetches the live pricing config, falling back to defaults if the doc doesn't exist yet. */
async function getPricingConfig() {
  const snap = await db.collection("config").doc("pricing").get();
  if (!snap.exists) return normalizePricingDoc(null);
  return normalizePricingDoc(snap.data());
}

/**
 * Admin-only: merges the given updates into the live config. Accepts
 * EITHER the new nested shape (premiumMonthly: {USD,NGN}, price:{USD,NGN})
 * OR legacy flat fields (premiumMonthlyUSD/NGN, priceUSD/NGN) — whatever
 * comes in is normalized before being written, so the stored document
 * self-heals toward the clean shape on every admin save instead of ever
 * needing a one-off migration script.
 */
async function updatePricingConfig(updates) {
  const current = await getPricingConfig();
  const merged = normalizePricingDoc({ ...current, ...updates });

  // Persist only the canonical nested shape — the legacy flat aliases are
  // derived on read, not stored, so Firestore itself is never a source of
  // stale duplicate data.
  const { premiumMonthlyUSD, premiumMonthlyNGN, premiumYearlyUSD, premiumYearlyNGN, ...toStore } = merged;

  await db.collection("config").doc("pricing").set(toStore, { merge: false });
  return getPricingConfig();
}

/** Returns { amount, currency } for a premium plan ("monthly"|"yearly") in the given currency. Throws on an unsupported currency. */
function getPremiumPrice(pricing, planType, currency) {
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw new Error(`Unsupported currency: ${currency}`);
  }
  const pair = planType === "yearly" ? pricing.premiumYearly : pricing.premiumMonthly;
  return pair[currency];
}

/** Returns the price of a credit pack in the given currency, or null if the pack/currency isn't found. */
function getPackPrice(pricing, packId, currency) {
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw new Error(`Unsupported currency: ${currency}`);
  }
  const pack = pricing.creditPacks.find((p) => p.id === packId);
  if (!pack) return null;
  return pack.price[currency];
}

/** Returns today's date as YYYY-MM-DD (UTC), used as the daily-reset key. */
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetches (or lazily creates) a user's profile document.
 * Shape: { plan, dailyMessagesUsed, lastResetDate, credits, referralCode, referredBy, referralCount }
 */
async function getUserProfile(uid) {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    const referralCode = await generateUniqueReferralCode();
    const defaults = {
      plan: "free",
      dailyMessagesUsed: 0,
      lastResetDate: todayKey(),
      credits: STARTER_CREDITS,
      referralCode,
      referredBy: null,
      referralCount: 0,
      referralRewardActivated: false,
      referralMilestonesGranted: [],
      createdAt: FieldValue.serverTimestamp()
    };
    await ref.set(defaults, { merge: true });
    await db.collection("referralCodes").doc(referralCode).set({ uid });
    return { uid, ...defaults };
  }

  // Backfill: the OLDER client-side signup path (utils.js VivyUser.getProfile,
  // called directly from the browser right after account creation) creates a
  // profile doc too, using an older/incompatible schema — no credits field,
  // no referralCode, dailyUsed/dailyDate instead of dailyMessagesUsed/
  // lastResetDate. If that ran first, this doc exists but is missing
  // everything the credit/referral system needs. Patch it in, once, here —
  // the one place every backend route already goes through to read a profile.
  const data = snap.data();
  const missing = {};
  if (data.credits === undefined) missing.credits = STARTER_CREDITS;
  if (data.dailyMessagesUsed === undefined) missing.dailyMessagesUsed = data.dailyUsed ?? 0;
  if (data.lastResetDate === undefined) missing.lastResetDate = data.dailyDate ?? todayKey();
  if (data.referralCode === undefined) {
    missing.referralCode = await generateUniqueReferralCode();
    await db.collection("referralCodes").doc(missing.referralCode).set({ uid });
  }
  if (data.referredBy === undefined) missing.referredBy = null;
  if (data.referralCount === undefined) missing.referralCount = 0;
  if (data.referralRewardActivated === undefined) missing.referralRewardActivated = false;
  if (data.referralMilestonesGranted === undefined) missing.referralMilestonesGranted = [];

  if (Object.keys(missing).length > 0) {
    await ref.set(missing, { merge: true });
    Object.assign(data, missing);
  }

  return { uid, ...data };
}

/**
 * Ensures the daily counter is reset if the stored date isn't today.
 * Always call this before checking/consuming a user's daily allowance.
 */
async function ensureDailyReset(uid) {
  const ref = db.collection("users").doc(uid);
  const profile = await getUserProfile(uid);
  const today = todayKey();

  if (profile.lastResetDate !== today) {
    await ref.update({ dailyMessagesUsed: 0, lastResetDate: today });
    profile.dailyMessagesUsed = 0;
    profile.lastResetDate = today;
  }

  return profile;
}

/** Returns the daily message limit for a given plan. */
function limitForPlan(plan) {
  return plan === "premium" ? PREMIUM_DAILY_MESSAGES : FREE_DAILY_MESSAGES;
}

/** True if the user still has messages remaining today. */
function hasRemainingMessages(profile) {
  return profile.dailyMessagesUsed < limitForPlan(profile.plan);
}

/** Increments today's usage counter by 1 (call only after a successful AI reply). */
async function incrementUsage(uid) {
  await db.collection("users").doc(uid).update({
    dailyMessagesUsed: FieldValue.increment(1)
  });
}

/**
 * Upgrades a user to Premium — called after a verified Flutterwave payment.
 * durationDays stacks onto any remaining time (a renewal before expiry
 * extends from the current expiry, not from "now"), so premium is a real
 * subscription, never permanent — matches "NO lifetime premium".
 */
async function upgradeToPremium(uid, transactionRef, durationDays = 30) {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  const existingUntil = snap.exists && snap.data().premiumUntil ? snap.data().premiumUntil.toMillis() : 0;
  const base = Math.max(existingUntil, Date.now());
  const premiumUntil = new Date(base + durationDays * 24 * 60 * 60 * 1000);

  await ref.set(
    {
      plan: "premium",
      premiumSince: FieldValue.serverTimestamp(),
      premiumUntil: admin.firestore.Timestamp.fromDate(premiumUntil),
      lastPaymentRef: transactionRef
    },
    { merge: true }
  );
}

/**
 * The one canonical "is this user actually premium right now" check.
 * Every other function in this file (and every route) should use this
 * instead of reading profile.plan directly, so an expired subscription
 * correctly stops being treated as premium everywhere at once.
 */
function isPremiumActive(profile) {
  if (profile.plan !== "premium") return false;
  if (!profile.premiumUntil) return false; // no expiry ever set — treat as not active, don't grandfather silently
  const untilMs = profile.premiumUntil.toMillis ? profile.premiumUntil.toMillis() : new Date(profile.premiumUntil).getTime();
  return untilMs > Date.now();
}

/* -----------------------------  CREDITS  ---------------------------------- */

/** True if the user can afford `cost` — active premium users always can (unlimited). */
function canAfford(profile, cost) {
  return isPremiumActive(profile) || (profile.credits || 0) >= cost;
}

/**
 * Deducts `cost` credits atomically inside a transaction, so two simultaneous
 * requests can't both read "enough credits" and both succeed, driving the
 * balance negative. Premium users are never charged. Throws a plain Error
 * with a recognizable message if the balance is insufficient, which routes
 * turn into a 402 response.
 */
async function deductCredits(uid, cost, reason) {
  const ref = db.collection("users").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const profile = snap.exists ? snap.data() : { plan: "free", credits: 0 };
    if (profile.plan === "premium") return; // unlimited — no deduction
    const balance = profile.credits || 0;
    if (balance < cost) {
      const err = new Error("Insufficient credits.");
      err.code = "INSUFFICIENT_CREDITS";
      err.balance = balance;
      err.required = cost;
      throw err;
    }
    tx.update(ref, { credits: balance - cost });
  });
  await db.collection("users").doc(uid).collection("creditLog").add({
    delta: -cost,
    reason,
    at: FieldValue.serverTimestamp()
  });
}

/** Adds credits — called after a verified credit-pack purchase. */
async function addCredits(uid, amount, reason) {
  await db.collection("users").doc(uid).set(
    { credits: FieldValue.increment(amount) },
    { merge: true }
  );
  await db.collection("users").doc(uid).collection("creditLog").add({
    delta: amount,
    reason,
    at: FieldValue.serverTimestamp()
  });
}

/* -----------------------------  FREE-PLAN LIMITS  ---------------------------------- */

async function getCampaignCount(uid) {
  const snap = await db.collection("users").doc(uid).collection("campaigns").count().get();
  return snap.data().count;
}

async function getConnectedAccountCount(uid) {
  const snap = await db.collection("users").doc(uid).collection("socialTokens").count().get();
  return snap.data().count;
}

/* -----------------------------  REFERRALS  ---------------------------------- */

/** Generates a "VIVY-XXXXX" code, retrying on the rare collision. */
async function generateUniqueReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — avoids visual ambiguity
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = "VIVY-";
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const existing = await db.collection("referralCodes").doc(code).get();
    if (!existing.exists) return code;
  }
  throw new Error("Could not generate a unique referral code — please try again.");
}

/**
 * Links a newly-registered user to whoever referred them. Only takes
 * effect once, only before any reward has been processed, and rejects
 * self-referral. Does NOT grant any reward yet — that only happens once
 * the referred user verifies their email and is confirmed active, via
 * processReferralActivation below.
 */
async function applyReferralCode(newUid, code) {
  const profile = await getUserProfile(newUid);
  if (profile.referredBy) return; // already linked — no-op, not an error

  const codeSnap = await db.collection("referralCodes").doc(code.toUpperCase().trim()).get();
  if (!codeSnap.exists) throw new Error("Invalid referral code.");
  const referrerUid = codeSnap.data().uid;
  if (referrerUid === newUid) throw new Error("You can't refer yourself.");

  await db.collection("users").doc(newUid).set({ referredBy: referrerUid }, { merge: true });
}

/**
 * Fraud-prevention checkpoint: called from an authenticated route the
 * referred user actually visits (e.g. loading their referral/settings
 * page), using the Firebase ID token's own email_verified claim — which
 * can't be spoofed by the client. Awards the referrer exactly once per
 * referred user, then checks milestone thresholds and grants each
 * milestone reward exactly once (tracked in referralMilestonesGranted so
 * re-running this never double-grants).
 */
async function processReferralActivation(uid, emailVerified) {
  if (!emailVerified) return;

  const profile = await getUserProfile(uid);
  if (!profile.referredBy || profile.referralRewardActivated) return;

  const referrerRef = db.collection("users").doc(profile.referredBy);

  await db.runTransaction(async (tx) => {
    const referredRef = db.collection("users").doc(uid);
    const referredSnap = await tx.get(referredRef);
    if (referredSnap.data().referralRewardActivated) return; // race guard

    const referrerSnap = await tx.get(referrerRef);
    if (!referrerSnap.exists) return; // referrer account no longer exists

    const newCount = (referrerSnap.data().referralCount || 0) + 1;
    tx.update(referrerRef, { referralCount: newCount });
    tx.update(referredRef, { referralRewardActivated: true });
  });

  await grantReferralMilestones(profile.referredBy);
}

/** Checks the referrer's count against configured milestones and grants any newly-reached ones. */
async function grantReferralMilestones(referrerUid) {
  const [profile, pricing] = await Promise.all([getUserProfile(referrerUid), getPricingConfig()]);
  const granted = profile.referralMilestonesGranted || [];

  for (const milestone of pricing.referralMilestones) {
    if (profile.referralCount < milestone.count) continue;
    if (granted.includes(milestone.count)) continue;

    if (milestone.rewardType === "credits") {
      await addCredits(referrerUid, milestone.amount, `referral_milestone:${milestone.count}`);
    } else if (milestone.rewardType === "premiumDays") {
      await upgradeToPremium(referrerUid, `referral_milestone:${milestone.count}`, milestone.amount);
    }

    await db.collection("users").doc(referrerUid).update({
      referralMilestonesGranted: FieldValue.arrayUnion(milestone.count)
    });
  }
}

/* -----------------------------  SOCIAL ACCOUNT TOKENS  ---------------------------
   Stored under users/{uid}/socialTokens/{platform} — deliberately NOT covered
   by any client-side Firestore security rule, so it's only ever readable via
   this Admin SDK. The frontend only ever sees the "connected: true/false"
   status mirrored into marketingSettings/connectedAccounts, never the token.
   ------------------------------------------------------------------------- */

/** Saves (or overwrites) a platform's access token + linked account info. */
async function saveSocialToken(uid, platform, data) {
  await db.collection("users").doc(uid).collection("socialTokens").doc(platform).set(
    { ...data, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function getSocialToken(uid, platform) {
  const snap = await db.collection("users").doc(uid).collection("socialTokens").doc(platform).get();
  return snap.exists ? snap.data() : null;
}

async function removeSocialToken(uid, platform) {
  await db.collection("users").doc(uid).collection("socialTokens").doc(platform).delete();
}

/** Mirrors a safe, non-secret connection status into the client-readable doc. */
async function setConnectedAccountStatus(uid, updates) {
  await db.collection("users").doc(uid).collection("marketingSettings").doc("connectedAccounts").set(
    updates,
    { merge: true }
  );
}

module.exports = {
  db,
  FieldValue,
  getUserProfile,
  ensureDailyReset,
  limitForPlan,
  hasRemainingMessages,
  incrementUsage,
  upgradeToPremium,
  isPremiumActive,
  saveSocialToken,
  getSocialToken,
  removeSocialToken,
  setConnectedAccountStatus,
  getPricingConfig,
  updatePricingConfig,
  getPremiumPrice,
  getPackPrice,
  SUPPORTED_CURRENCIES,
  canAfford,
  deductCredits,
  addCredits,
  getCampaignCount,
  getConnectedAccountCount,
  generateUniqueReferralCode,
  applyReferralCode,
  processReferralActivation,
  FREE_DAILY_MESSAGES,
  PREMIUM_DAILY_MESSAGES,
  STARTER_CREDITS
};
