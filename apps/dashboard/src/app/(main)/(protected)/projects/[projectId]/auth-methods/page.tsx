import PageClient from "./page-client";

export const metadata = {
  title: "Auth Settings",
};


export const generateStaticParams = async () => {
  return [];
};

export const dynamicParams = true;

export default function Page() {
  return (
    <PageClient />
  );
}
