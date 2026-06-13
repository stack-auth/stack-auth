import React from "react";

export function PageLayout(props: { children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-4'>
      {props.children}
    </div>
  );
}
