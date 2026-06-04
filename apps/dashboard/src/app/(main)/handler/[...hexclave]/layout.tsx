import { Navbar } from "@/components/navbar";

export default function Page ({ children } : { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen">
      <Navbar />
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
}
