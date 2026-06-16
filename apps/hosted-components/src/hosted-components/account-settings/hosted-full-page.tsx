import React from "react";

export function HostedFullPage(props: {
  children: React.ReactNode,
  fullPage?: boolean,
}) {
  if (!props.fullPage) {
    return <>{props.children}</>;
  }

  return (
    <div
      data-hexclave-handler-page
      className="stack-scope min-h-screen w-full flex flex-col"
    >
      {props.children}
    </div>
  );
}
