import { redirect } from "next/navigation";

/**
 * @dashboardReference convex/convex-integration
 * @dashboardReferenceDescription Hexclave + Convex integration (dashboard entry redirects to docs).
 *
 * ## Behavior
 *
 * Opening **Convex Integration** in the project sidebar immediately redirects to the public [Convex integration guide](https://docs.hexclave.com/guides/integrations/convex/overview). There is no in-dashboard configuration UI on this route.
 *
 * ## Setup (off-dashboard)
 *
 * Follow the linked docs to install the Convex component, wire auth, and sync users/teams. Enable the **Convex** app in the app store so the sidebar entry stays available.
 */

export default function Page() {
  redirect("https://docs.hexclave.com/guides/integrations/convex/overview");
}
