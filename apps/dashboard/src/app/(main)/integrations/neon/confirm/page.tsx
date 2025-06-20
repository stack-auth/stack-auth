import IntegrationConfirmPage from "../../oauth-confirm-page";

export const metadata = {
  title: "Neon x Stack Auth",
};

export default async function Page(props: { searchParams: Promise<{ interaction_uid: string }> }) {
  return <IntegrationConfirmPage searchParams={props.searchParams} type="neon" />;
}
