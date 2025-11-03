import type { CurrentUser } from "@stackframe/js";
import { stackClientApp } from "./stack";

const signedOutCard = document.getElementById("signedOutCard") as HTMLElement;
const signedInCard = document.getElementById("signedInCard") as HTMLElement;
const signInForm = document.getElementById("signInForm") as HTMLFormElement;
const signInButton = document.getElementById("signInButton") as HTMLButtonElement;
const signOutButton = document.getElementById("signOutButton") as HTMLButtonElement;
const emailInput = document.getElementById("emailInput") as HTMLInputElement;
const passwordInput = document.getElementById("passwordInput") as HTMLInputElement;
const signedOutStatus = document.getElementById("signedOutStatus") as HTMLElement;
const errorMessage = document.getElementById("errorMessage") as HTMLElement;
const profileName = document.getElementById("profileName") as HTMLElement;
const profileEmail = document.getElementById("profileEmail") as HTMLElement;

let currentUser: CurrentUser | null = null;

function describeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as any).message;
    return typeof message === "string" ? message : JSON.stringify(message);
  }
  return typeof err === "string" ? err : "Something went wrong.";
}

function showSignedOut(message: string) {
  signedOutStatus.textContent = message;
  signedOutCard.classList.remove("hidden");
  signedInCard.classList.add("hidden");
}

function showSignedIn(user: CurrentUser) {
  profileName.textContent = user.displayName ?? user.primaryEmail ?? "Signed in user";
  profileEmail.textContent = user.primaryEmail ?? "—";
  signedOutCard.classList.add("hidden");
  signedInCard.classList.remove("hidden");
}

async function refreshUser() {
  signedOutStatus.textContent = "Checking session…";
  errorMessage.textContent = "";
  signInButton.disabled = false;
  signOutButton.disabled = false;

  try {
    currentUser = await stackClientApp.getUser({ or: "return-null" });
    if (currentUser) {
      showSignedIn(currentUser);
    } else {
      showSignedOut("Sign in to continue.");
    }
  } catch (err) {
    showSignedOut("Unable to verify session.");
    errorMessage.textContent = describeError(err);
  }
}

async function attemptSignUp(email: string, password: string) {
  const signUpResult = await stackClientApp.signUpWithCredential({
    email,
    password,
    noRedirect: true,
    noVerificationCallback: true,
  });

  if (signUpResult.status === "ok") {
    signedOutStatus.textContent = "Account created!";
    await refreshUser();
    passwordInput.value = "";
  } else {
    errorMessage.textContent = signUpResult.error.message;
    signedOutStatus.textContent = "Sign in to continue.";
  }
}

signInForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    errorMessage.textContent = "Enter your email and password.";
    return;
  }

  errorMessage.textContent = "";
  signedOutStatus.textContent = "Signing you in…";
  signInButton.disabled = true;

  try {
    const signInResult = await stackClientApp.signInWithCredential({
      email,
      password,
      noRedirect: true,
    });

    if (signInResult.status === "ok") {
      signedOutStatus.textContent = "Welcome back!";
      await refreshUser();
      passwordInput.value = "";
      return;
    }

    if ((signInResult.error as any).code === "EMAIL_PASSWORD_MISMATCH") {
      signedOutStatus.textContent = "No account found yet. Creating one…";
      await attemptSignUp(email, password);
    } else {
      errorMessage.textContent = signInResult.error.message;
      signedOutStatus.textContent = "We couldn't sign you in.";
    }
  } catch (err) {
    errorMessage.textContent = describeError(err);
    signedOutStatus.textContent = "We couldn't sign you in.";
  } finally {
    signInButton.disabled = false;
  }
});

signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;
  signedOutStatus.textContent = "Signing you out…";
  errorMessage.textContent = "";

  try {
    const user = currentUser ?? await stackClientApp.getUser({ or: "return-null" });
    if (!user) {
      signedOutStatus.textContent = "You're already signed out.";
      signOutButton.disabled = false;
      return;
    }

    await user.signOut({ redirectUrl: window.location.href });
    currentUser = null;
    await refreshUser();
  } catch (err) {
    errorMessage.textContent = describeError(err);
    signedOutStatus.textContent = "We couldn't sign you out.";
    signOutButton.disabled = false;
  }
});

void refreshUser();
