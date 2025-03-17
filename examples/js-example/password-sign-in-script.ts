import { stackClientApp } from "./stack";

// Check if user is already signed in
stackClientApp.getUser().then((user) => {
  if (user) {
    window.location.href = "/";
  }
});

document.getElementById("showSignUp")?.addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("loginForm")?.classList.add("hidden");
  document.getElementById("signUpForm")?.classList.remove("hidden");
});

document.getElementById("showSignIn")?.addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("loginForm")?.classList.remove("hidden");
  document.getElementById("signUpForm")?.classList.add("hidden");
});

document.getElementById("signIn")?.addEventListener("click", async () => {
  const emailInput = document.getElementById("emailInput") as HTMLInputElement;
  const passwordInput = document.getElementById("passwordInput") as HTMLInputElement;

  const result = await stackClientApp.signInWithCredential({
    email: emailInput.value,
    password: passwordInput.value,
  });

  if (result.status === "error") {
    alert("Sign in failed. Please check your email and password and try again.");
  } else {
    window.location.href = "/";
  }
});

document.getElementById("signUp")?.addEventListener("click", async () => {
  const emailInput = document.getElementById("signUpEmail") as HTMLInputElement;
  const passwordInput = document.getElementById("signUpPassword") as HTMLInputElement;

  const result = await stackClientApp.signUpWithCredential({
    email: emailInput.value,
    password: passwordInput.value,
  });

  if (result.status === "error") {
    alert("Sign up failed. Please try again.");
    return;
  }

  const signInResult = await stackClientApp.signInWithCredential({
    email: emailInput.value,
    password: passwordInput.value,
  });

  if (signInResult.status === "error") {
    alert("Account created but sign in failed. Please sign in manually.");
  } else {
    window.location.href = "/";
  }
});
