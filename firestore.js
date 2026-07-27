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

/** Returns today's date as YYYY-MM-DD (UTC), used as the daily-reset key. */
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetches (or lazily creates) a user's profile document.
 * Shape: { plan, dailyMessagesUsed, lastResetDate }
 */
async function getUserProfile(uid) {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    const defaults = {
      plan: "free",
      dailyMessagesUsed: 0,
      lastResetDate: todayKey(),
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

module.exports = {
  db,
  FieldValue,
  getUserProfile,
  ensureDailyReset,
  limitForPlan,
  hasRemainingMessages,
  incrementUsage,
  upgradeToPremium,
  FREE_DAILY_MESSAGES,
  PREMIUM_DAILY_MESSAGES
};
