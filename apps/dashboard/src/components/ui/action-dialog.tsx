'use client';

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { InfoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import {
  DesignButton,
  DesignDialog,
  type DesignDialogSize,
} from "@hexclave/dashboard-ui-components";
import React, { Suspense, useId } from "react";
import { Alert } from "./alert";
import { Checkbox } from "./checkbox";
import { Label } from "./label";
import { Skeleton } from "./skeleton";

export type ActionDialogProps = {
  trigger?: React.ReactNode,
  open?: boolean,
  onClose?: () => void,
  onOpenChange?: (open: boolean) => void,
  titleIcon?: PhosphorIcon,
  title: boolean | React.ReactNode,
  description?: React.ReactNode,
  danger?: boolean,
  okButton?: boolean | Readonly<{
    label?: string,
    onClick?: () => Promise<"prevent-close" | undefined | void>,
    props?: Partial<React.ComponentProps<typeof DesignButton>>,
  }>,
  cancelButton?: boolean | Readonly<{
    label?: string,
    onClick?: () => Promise<"prevent-close" | undefined | void>,
    props?: Partial<React.ComponentProps<typeof DesignButton>>,
  }>,
  confirmText?: string,
  children?: React.ReactNode,
  preventClose?: boolean,
  /**
   * When true, pointer / focus outside the dialog does not dismiss it (overlay clicks, third-party
   * fixed UI such as preview toolbars, etc.). Header close, Escape, and explicit actions still work.
   * Unlike `preventClose`, this does not hide the dialog’s close button.
   */
  keepOpenOnOutsideInteraction?: boolean,
  /**
   * Extra classes merged onto the dialog's content surface. Useful for variant chrome
   * (border, ring, bg, shadow, padding, rounded, etc.).
   */
  contentClassName?: string,
  size?: DesignDialogSize,
};

export function ActionDialog(props: ActionDialogProps) {
  const okButton = props.okButton === true ? {} : props.okButton;
  const cancelButton = props.cancelButton === true ? {} : props.cancelButton;
  const anyButton = !!(okButton || cancelButton);
  const title = props.title === true ? (props.cancelButton ? "Confirmation" : "Alert") : props.title;
  const TitleIcon = props.titleIcon || (props.danger ? WarningCircleIcon : InfoIcon);
  const [openState, setOpenState] = React.useState(!!props.open);
  const open = props.open ?? openState;
  const [confirmed, setConfirmed] = React.useState(false);
  const confirmId = useId();
  const [invalidationCount, setInvalidationCount] = React.useState(0);
  const okButtonExtraProps = okButton && typeof okButton === "object" ? okButton.props : undefined;
  const { disabled: okButtonDisabledProp, ...okButtonProps } = okButtonExtraProps ?? {};
  const okButtonDisabled = (!!props.confirmText && !confirmed) || !!okButtonDisabledProp;

  const blockDismissOnOutside = !!(props.preventClose || props.keepOpenOnOutsideInteraction);

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      props.onClose?.();
      setConfirmed(false);
    } else {
      setInvalidationCount(invalidationCount + 1);
    }
    setOpenState(nextOpen);
    props.onOpenChange?.(nextOpen);
  };

  const trigger = props.trigger == null
    ? undefined
    : React.isValidElement(props.trigger)
      ? props.trigger
      : throwErr("ActionDialog trigger must be a React element because DesignDialog renders it with asChild");

  return (
    <DesignDialog
      key={invalidationCount}
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      size={props.size ?? "lg"}
      icon={TitleIcon}
      title={title}
      description={props.description}
      hideTopCloseButton={props.preventClose}
      className={props.contentClassName}
      contentProps={{
        onInteractOutside: blockDismissOnOutside ? (e) => e.preventDefault() : undefined,
        onPointerDownOutside: blockDismissOnOutside ? (e) => e.preventDefault() : undefined,
        onFocusOutside: blockDismissOnOutside ? (e) => e.preventDefault() : undefined,
      }}
      footer={anyButton ? (
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {cancelButton && (
            <DesignButton
              variant="secondary"
              onClick={async () => {
                if (await cancelButton.onClick?.() !== "prevent-close") {
                  onOpenChange(false);
                }
              }}
              {...cancelButton.props}
            >
              {cancelButton.label ?? "Cancel"}
            </DesignButton>
          )}
          {okButton && (
            <DesignButton
              disabled={okButtonDisabled}
              variant={props.danger ? "destructive" : "default"}
              onClick={async () => {
                if (await okButton.onClick?.() !== "prevent-close") {
                  onOpenChange(false);
                }
              }}
              {...okButtonProps}
            >
              {okButton.label ?? "OK"}
            </DesignButton>
          )}
        </div>
      ) : undefined}
    >
      <Suspense fallback={
        <>
          <Skeleton className='h-9 w-2/3 self-center' />

          <Skeleton className='h-3 w-16 mt-8' />
          <Skeleton className='h-9 w-full mt-1' />

          <Skeleton className='h-3 w-24 mt-2' />
          <Skeleton className='h-9 w-full mt-1' />

          <Skeleton className='h-9 w-full mt-6' />
        </>
      }>
        {props.children}
      </Suspense>

      {props.confirmText && (
        <Alert className="mt-4">
          <Label className="flex gap-4 items-center">
            <Checkbox id={confirmId} checked={confirmed} onCheckedChange={(v) => setConfirmed(!!v)}/>
            {props.confirmText}
          </Label>
        </Alert>
      )}
    </DesignDialog>
  );
}
