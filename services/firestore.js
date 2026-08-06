/* ==========================================================================
   services/firestore.js
   Single place that owns the Firebase Admin SDK instance and every
   Firestore read/write the backend needs — user profiles, daily AI usage
   tracking, and plan upgrades (used by both the AI routes and the
   Flutterwave payment routes).
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

/**
 * Default credit costs and free-plan limits. Stored in Firestore at
 * config/pricing so the Admin Dashboard can edit them live without a
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
    autopilotCampaign: 100
  },
  freePlanLimits: {
    maxCampaigns: 3,
    maxConnectedAccounts: 1,
    autopilotEnabled: false,
    autoPublishEnabled: false,
    analyticsEnabled: false
  },
  creditPacks: [
    { id: "pack_500", credits: 500, priceNGN: 2500 },
    { id: "pack_1000", credits: 1000, priceNGN: 4500 },
    { id: "pack_5000", credits: 5000, priceNGN: 20000 },
    { id: "pack_10000", credits: 10000, priceNGN: 35000 }
  ],
  premiumMonthlyNGN: 2500,
  premiumYearlyNGN: 25000
};

/** Fetches the live pricing config, falling back to defaults if the doc doesn't exist yet. */
async function getPricingConfig() {
  const snap = await db.collection("config").doc("pricing").get();
  if (!snap.exists) return DEFAULT_PRICING;
  // Merge over defaults so a partially-edited doc (e.g. admin only changed
  // costs) doesn't lose freePlanLimits/creditPacks that were never touched.
  const stored = snap.data();
  return {
    costs: { ...DEFAULT_PRICING.costs, ...stored.costs },
    freePlanLimits: { ...DEFAULT_PRICING.freePlanLimits, ...stored.freePlanLimits },
    creditPacks: stored.creditPacks || DEFAULT_PRICING.creditPacks,
    premiumMonthlyNGN: stored.premiumMonthlyNGN ?? DEFAULT_PRICING.premiumMonthlyNGN,
    premiumYearlyNGN: stored.premiumYearlyNGN ?? DEFAULT_PRICING.premiumYearlyNGN
  };
}

/** Admin-only: overwrites (merges into) the live pricing config. */
async function updatePricingConfig(updates) {
  await db.collection("config").doc("pricing").set(updates, { merge: true });
  return getPricingConfig();
}

/** Returns today's date as YYYY-MM-DD (UTC), used as the daily-reset key. */
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetches (or lazily creates) a user's profile document.
 * Shape: { plan, dailyMessagesUsed, lastResetDate, credits, campaignCount, connectedAccountCount }
 */
async function getUserProfile(uid) {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    const defaults = {
      plan: "free",
      dailyMessagesUsed: 0,
      lastResetDate: todayKey(),
      credits: STARTER_CREDITS,
      createdAt: FieldValue.serverTimestamp()
    };
    await ref.set(defaults, { merge: true });
    return { uid, ...defaults };
  }

  return { uid, ...snap.data() };
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

/** Upgrades a user to Premium — called after a verified Flutterwave payment. */
async function upgradeToPremium(uid, transactionRef) {
  await db.collection("users").doc(uid).set(
    {
      plan: "premium",
      premiumSince: FieldValue.serverTimestamp(),
      lastPaymentRef: transactionRef
    },
    { merge: true }
  );
}

/* -----------------------------  CREDITS  ---------------------------------- */

/** True if the user can afford `cost` — premium users always can (unlimited). */
function canAfford(profile, cost) {
  return profile.plan === "premium" || (profile.credits || 0) >= cost;
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
  saveSocialToken,
  getSocialToken,
  removeSocialToken,
  setConnectedAccountStatus,
  getPricingConfig,
  updatePricingConfig,
  canAfford,
  deductCredits,
  addCredits,
  getCampaignCount,
  getConnectedAccountCount,
  FREE_DAILY_MESSAGES,
  PREMIUM_DAILY_MESSAGES,
  STARTER_CREDITS
};
