import { Navbar } from "@/components/navbar";
import { redirectToProjectIfEmulator } from "@/lib/utils";

export default function Page ({ children } : { children?: React.ReactNode }) {
  redirectToProjectIfEmulator();

  return (
    <div className="flex flex-col min-h-screen relative">
      <Navbar />
      {children}
    </div>
  );
}
