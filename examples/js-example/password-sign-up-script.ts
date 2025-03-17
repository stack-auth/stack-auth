import { stackClientApp } from "./stack";

// Check if user is already signed in
stackClientApp.getUser().then((user) => {
  if (user) {
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
    window.location.href = "/password-sign-in";
  } else {
    window.location.href = "/";
  }
}); 
