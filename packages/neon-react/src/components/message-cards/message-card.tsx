'use client';


//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================

import React from "react";
import { MaybeFullPage } from "../elements/maybe-full-page";
import { Button, Typography } from "@stackframe/stack-ui";

export function MessageCard(
  { fullPage=false, ...props }:
  {
    children?: React.ReactNode,
    title: string,
    fullPage?: boolean,
    primaryButtonText?: string,
    primaryAction?: () => Promise<void> | void,
    secondaryButtonText?: string,
    secondaryAction?: () => Promise<void> | void,
  }
) {
  return (
    <MaybeFullPage fullPage={fullPage}>
      <div className="text-center stack-scope flex flex-col gap-4" style={{ maxWidth: '380px', flexBasis: '380px', padding: fullPage ? '1rem' : 0 }}>
        <Typography type='h3'>{props.title}</Typography>
        {props.children}
        {(props.primaryButtonText || props.secondaryButtonText) && (
          <div className="flex justify-center gap-4 my-5">
            {props.secondaryButtonText && (
              <Button variant="secondary" onClick={props.secondaryAction}>
                {props.secondaryButtonText}
              </Button>
            )}
            {props.primaryButtonText && (
              <Button onClick={props.primaryAction}>
                {props.primaryButtonText}
              </Button>
            )}
          </div>
        )}
      </div>
    </MaybeFullPage>
  );
}
