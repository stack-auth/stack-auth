import { stackClientApp } from "./stack";

const updateUIState = (user: any | null) => {
  const authOptions = document.getElementById("authOptions");
  const userInfo = document.getElementById("userInfo");
  const userEmailSpan = document.getElementById("userEmail");

  if (user) {
    if (authOptions) authOptions.style.display = "none";
    if (userInfo) userInfo.style.display = "block";
    if (userEmailSpan) userEmailSpan.textContent = user.primaryEmail || "";
  } else {
    if (authOptions) authOptions.style.display = "block";
    if (userInfo) userInfo.style.display = "none";
  }
};

// Check if user is already signed in
stackClientApp.getUser().then(updateUIState);

// Handle Sign Out
document.getElementById("signOut")?.addEventListener("click", async () => {
  const user = await stackClientApp.getUser();
  if (user) {
    await user.signOut();
    updateUIState(null);
  }
}); 
