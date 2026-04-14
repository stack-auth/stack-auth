"use client";

import { StackHandler } from "@stackframe/stack";
import { useEffect, useState } from "react";

export default function Handler() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <StackHandler fullPage />;
}
