"use client";

import { captureError } from "@stackframe/stack-shared/utils/errors";
import Error from "next/error";
import { useEffect } from "react";

export default function GlobalError({ error }: any) {
  useEffect(() => {
    captureError("backend-global-error", error);
  }, [error]);

  return (
    <html>
      <body>
        [An unhandled error occurred.]
        <Error
          statusCode={500}
        />
      </body>
    </html>
  );
}
