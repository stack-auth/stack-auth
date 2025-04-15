'use client';

import { UserButton } from "@stackframe/stack";
import { useTheme } from "next-themes";
import Image from "next/image";
import Link from "next/link";

export default function Header() {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <div className="fixed w-full z-50 p-4 h-12 flex items-center py-4 border-b justify-between bg-white dark:bg-black dark:border-gray-800">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-semibold flex items-center gap-2">
            <Image
              src="/logo.svg"
              alt="Stack Auth Logo"
              width={64}
              height={64}
              className="dark:invert"
            />
            Demo
          </Link>
          <Link href="/apikey-demo" className="text-sm hover:text-gray-600 dark:hover:text-gray-300">
            API Key Demo
          </Link>
        </div>

        <div className="flex items-center justify-end gap-5">
          <UserButton colorModeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        </div>
      </div>
      <div className="min-h-12"/> {/* Placeholder for fixed header */}
    </>
  );
}
