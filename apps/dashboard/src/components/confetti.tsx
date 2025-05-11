"use client";

import { throwErr } from "@stackframe/stack-shared/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/utils/promises";
import * as confetti from "canvas-confetti";
import { useEffect } from "react";


export function Confetti() {
  useEffect(() => {
    runAsynchronously(confetti.default() ?? throwErr("Confetti failed to load"));
  }, []);

  return (<></>);
}
