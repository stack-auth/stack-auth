import { Instrument_Serif } from "next/font/google";
import PageClient from "./page-client";

// Editorial display serif for the briefing masthead and section headings.
// Upright only — italics are banned in this dashboard.
const briefingSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-briefing-serif",
});

export const metadata = {
  title: "Daily Briefing",
};

export default function Page() {
  return (
    <div className={briefingSerif.variable}>
      <PageClient />
    </div>
  );
}
