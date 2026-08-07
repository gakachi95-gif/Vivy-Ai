/* ==========================================================================
   VIVY AI — auth.js
   Firebase Authentication helpers used by login.html, register.html, and
   settings.html. requireAuth() / redirectIfAuthed() live in utils.js — this
   file only covers the actual sign-in/sign-up/sign-out actions.
   ========================================================================== */

const googleProvider = new firebase.auth.GoogleAuthProvider();

/**
 * Some environments (in-app browsers like Facebook/TikTok/Instagram's
 * built-in webview, private/incognito mode, some in-app webviews) restrict
 * storage access and throw auth/unsupported-persistence-type when Firebase
 * tries to set LOCAL/SESSION persistence. When that happens we fall back to
 * Firebase's default in-memory persistence instead of blocking sign-in.
 */
async function trySetPersistence(remember) {
  try {
    await auth.setPersistence(
      remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION
    );
  } catch (e) {
    console.warn("Persistence not supported in this browser, using default:", e.message);
  }
}

/** Signs in with email/password. `remember` controls session persistence. */
async function signInWithEmail(email, password, remember = true) {
  await trySetPersistence(remember);
  return auth.signInWithEmailAndPassword(email, password);
}

/** Creates a new account, sets the display name, and seeds the Firestore profile. */
async function signUpWithEmail(username, email, password, referralCode = null) {
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  await cred.user.updateProfile({ displayName: username });
  await VivyUser.getProfile(cred.user.uid); // lazily creates the default profile doc

  if (referralCode) {
    try {
      const token = await cred.user.getIdToken();
      await fetch(`${VIVY_API_BASE}/referrals/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: referralCode })
      });
      // Non-fatal if this fails — account creation already succeeded, and
      // a failed referral link shouldn't block signup. Silently skip.
    } catch (e) {
      console.warn("Referral code could not be applied:", e.message);
    }
  }

  return cred;
}

/** Google sign-in popup (works for both login and register flows). */
async function signInWithGoogle(remember = true, referralCode = null) {
  await trySetPersistence(remember);
  const cred = await auth.signInWithPopup(googleProvider);
  await VivyUser.getProfile(cred.user.uid); // no-op if the profile already exists

  if (referralCode) {
    try {
      const token = await cred.user.getIdToken();
      await fetch(`${VIVY_API_BASE}/referrals/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: referralCode })
      });
    } catch (e) {
      console.warn("Referral code could not be applied:", e.message);
    }
  }

  return cred;
}

/** Sends a password-reset email. */
async function sendPasswordReset(email) {
  return auth.sendPasswordResetEmail(email);
}

/** Signs the current user out and returns to the login screen. */
async function logoutUser() {
  await auth.signOut();
  window.location.href = "login.html";
}

/** Converts Firebase Auth error codes into short, human-readable messages. */
function friendlyAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "An account already exists with that email.",
    "auth/weak-password": "Please choose a stronger password (6+ characters).",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/network-request-failed": "Network error — please check your connection.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/unsupported-persistence-type": "This browser doesn't support staying signed in — try opening the site in Chrome or Safari instead of an in-app browser."
  };
  return map[code] || err?.message || "Something went wrong. Please try again.";
     }
