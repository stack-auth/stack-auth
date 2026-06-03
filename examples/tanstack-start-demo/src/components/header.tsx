import { Link } from "@tanstack/react-router";
import { UserButton } from "@hexclave/tanstack-start";

export function Header() {
  return (
    <>
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4">
          <nav className="flex items-center gap-4">
            <Link to="/" className="font-semibold tracking-tight">
              Hexclave TanStack Demo
            </Link>
            <Link to="/ssr" className="text-sm text-zinc-600 hover:text-zinc-950 hover:transition-none dark:text-zinc-300 dark:hover:text-white">
              SSR
            </Link>
            <Link to="/client" className="text-sm text-zinc-600 hover:text-zinc-950 hover:transition-none dark:text-zinc-300 dark:hover:text-white">
              Client
            </Link>
            <Link to="/protected" className="text-sm text-zinc-600 hover:text-zinc-950 hover:transition-none dark:text-zinc-300 dark:hover:text-white">
              Protected
            </Link>
          </nav>
          <UserButton />
        </div>
      </header>
      <div className="h-14" />
    </>
  );
}
