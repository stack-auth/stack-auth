import { hexclaveClientApp } from "./hexclave";

// Check if user is already signed in
hexclaveClientApp.getUser().then((user) => {
  if (user) {
    window.location.href = "/";
  }
});

document.getElementById("signUp")?.addEventListener("click", async () => {
  const emailInput = document.getElementById("signUpEmail") as HTMLInputElement;
  const passwordInput = document.getElementById("signUpPassword") as HTMLInputElement;

  const result = await hexclaveClientApp.signUpWithCredential({
    email: emailInput.value,
    password: passwordInput.value,
  });

  if (result.status === "error") {
    alert("Sign up failed. Please try again.");
    return;
  }

  const signInResult = await hexclaveClientApp.signInWithCredential({
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
