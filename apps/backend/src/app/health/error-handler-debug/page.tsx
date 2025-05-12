"use client";

import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";

export default function Page() {
  return <div>
    This page is useful for testing error handling.<br />
    Your observability platform should pick up on the errors thrown below.<br />
    <button onClick={() => throwErr(`Client debug error thrown successfully!`)}>Throw client error</button>
    <button onClick={() => {
      console.log("Endpoint request", fetch("/health/error-handler-debug/endpoint"));
    }}>Throw server error</button>
  </div>;
}
