import { stackClientApp } from "./stack";

// Check if user is already signed in
stackClientApp.getUser().then((user) => {
  if (user) {
    window.location.href = "/";
  }
});

let email = '';

document.getElementById("sendCode")?.addEventListener("click", async () => {
  const emailInput = document.getElementById("emailInput") as HTMLInputElement;
  email = emailInput.value;

  try {
    const result = await stackClientApp.sendMagicLinkEmail(email, {
      callbackUrl: window.location.origin + "/otp-sign-in",
    });

    if (result.status === "error") {
      alert("Failed to send code. Please try again.");
      return;
    } else {
      // Store the nonce in localStorage
      localStorage.setItem('magicLinkNonce', result.data.nonce);
    }

    const emailStep = document.getElementById("emailStep");
    const codeStep = document.getElementById("codeStep");
    if (emailStep) emailStep.style.display = "none";
    if (codeStep) codeStep.style.display = "block";
  } catch (error) {
    console.error("Failed to send code:", error);
    alert("Failed to send code. Please try again.");
  }
});

document.getElementById("verifyCode")?.addEventListener("click", async () => {
  const codeInput = document.getElementById("codeInput") as HTMLInputElement;
  const nonce = localStorage.getItem('magicLinkNonce');
  
  try {
    const result = await stackClientApp.signInWithMagicLink(`${codeInput.value}${nonce}`);

    if (result.status === "error") {
      alert("Invalid code. Please try again.");
      return;
    }

    // Clear the nonce after successful verification
    localStorage.removeItem('magicLinkNonce');
    window.location.href = "/";
  } catch (error) {
    console.error("Failed to verify code:", error);
    alert("Failed to verify code. Please try again.");
  }
});

// Handle magic link code from URL
const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get('code');
if (code) {
  (async () => {
    try {
      const result = await stackClientApp.signInWithMagicLink(code);
      if (result.status === "error") {
        alert("This magic link is invalid or has expired. Please request a new one.");
      } else {
        window.location.href = "/";
      }
    } catch (error) {
      console.error("Failed to verify magic link:", error);
      alert("This magic link is invalid or has expired. Please request a new one.");
    }
  })();
}
