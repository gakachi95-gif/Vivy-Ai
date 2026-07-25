/* ==========================================================================
   VIVY AI — auth.js
   All authentication logic: email/password sign up & sign in, Google sign
   in, forgot password, remember me, and secure logout. Also creates the
   user's Firestore profile document on first sign-in.
   ========================================================================== */

const googleProvider = new firebase.auth.GoogleAuthProvider();

/* -----------------------------  REMEMBER ME  ------------------------------- */
/**
 * Sets Firebase Auth persistence based on the "remember me" checkbox.
 * LOCAL = survives browser restarts. SESSION = cleared when tab closes.
 */
async function setAuthPersistence(remember) {
  const mode = remember
    ? firebase.auth.Auth.Persistence.LOCAL
    : firebase.auth.Auth.Persistence.SESSION;
  await auth.setPersistence(mode);
}

/* -----------------------------  PROFILE CREATION  --------------------------- */
/** Creates the Firestore user profile on first login (idempotent). */
async function ensureUserProfile(user) {
  const ref = db.collection("users").doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      username: user.displayName || user.email.split("@")[0],
      email: user.email,
      photoURL: user.photoURL || "",
      plan: "free",
      dailyUsed: 0,
      dailyDate: new Date().toISOString().slice(0, 10),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

/* -----------------------------  SIGN UP  ------------------------------------ */
async function signUpWithEmail(username, email, password) {
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  await cred.user.updateProfile({ displayName: username });
  await ensureUserProfile({ ...cred.user, displayName: username });
  return cred.user;
}

/* -----------------------------  SIGN IN  ------------------------------------ */
async function signInWithEmail(email, password, remember) {
  await setAuthPersistence(remember);
  const cred = await auth.signInWithEmailAndPassword(email, password);
  await ensureUserProfile(cred.user);
  return cred.user;
}

async function signInWithGoogle(remember = true) {
  await setAuthPersistence(remember);
  const cred = await auth.signInWithPopup(googleProvider);
  await ensureUserProfile(cred.user);
  return cred.user;
}

/* -----------------------------  FORGOT PASSWORD  ----------------------------- */
async function sendPasswordReset(email) {
  await auth.sendPasswordResetEmail(email);
}

/* -----------------------------  LOGOUT  -------------------------------------- */
async function logoutUser() {
  await auth.signOut();
  window.location.href = "login.html";
}

/* -----------------------------  FRIENDLY ERROR MESSAGES  --------------------- */
/** Converts Firebase auth error codes into human-readable messages. */
function friendlyAuthError(error) {
  const map = {
    "auth/email-already-in-use": "That email is already registered. Try signing in instead.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/network-request-failed": "Network error. Check your connection and try again."
  };
  return map[error.code] || error.message || "Something went wrong. Please try again.";
}
