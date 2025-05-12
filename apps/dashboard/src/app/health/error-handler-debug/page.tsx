"use client";

import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { Button } from "@stackframe/stack-ui";

export default function Page() {
  return <div>
    This page is useful for testing error handling.<br />
    Your observability platform should pick up on the errors thrown below.<br />
    <Button onClick={() => throwErr(`Client debug error thrown successfully!`)}>Throw client error</Button>
    <Button onClick={async () => {
      console.log("Endpoint response", await fetch("/health/error-handler-debug/endpoint"));
    }}>Throw server error</Button>
  </div>;
}
