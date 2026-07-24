import { Navbar } from "@/components/navbar";

export default function Page ({ children } : { children?: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <Navbar />
      {/* min-h-0 so flex children can use h-full / flex-1 without overflowing the viewport */}
      <div className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
