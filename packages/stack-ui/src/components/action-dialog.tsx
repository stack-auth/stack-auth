'use client';

import { CircleAlert, Info, LucideIcon } from "lucide-react";
import React, { Suspense, useId } from "react";
import { Alert, Button, Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Label, Skeleton } from '..';

export type ActionDialogProps = {
  trigger?: React.ReactNode,
  open?: boolean,
  onClose?: () => void,
  onOpenChange?: (open: boolean) => void,
  titleIcon?: LucideIcon,
  title: boolean | React.ReactNode,
  description?: React.ReactNode,
  danger?: boolean,
  okButton?: boolean | Readonly<{
    label?: string,
    onClick?: () => Promise<"prevent-close" | undefined | void>,
    props?: Partial<React.ComponentProps<typeof Button>>,
  }>,
  cancelButton?: boolean | Readonly<{
    label?: string,
    onClick?: () => Promise<"prevent-close" | undefined | void>,
    props?: Partial<React.ComponentProps<typeof Button>>,
  }>,
  confirmText?: string,
  children?: React.ReactNode,
  preventClose?: boolean,
};

export function ActionDialog(props: ActionDialogProps) {
  const okButton = props.okButton === true ? {} : props.okButton;
  const cancelButton = props.cancelButton === true ? {} : props.cancelButton;
  const anyButton = !!(okButton || cancelButton);
  const title = props.title === true ? (props.cancelButton ? "Confirmation" : "Alert") : props.title;
  const TitleIcon = props.titleIcon || (props.danger ? CircleAlert : Info);
  const [openState, setOpenState] = React.useState(!!props.open);
  const open = props.open ?? openState;
  const [confirmed, setConfirmed] = React.useState(false);
  const confirmId = useId();
  const [invalidationCount, setInvalidationCount] = React.useState(0);

  const onOpenChange = (open: boolean) => {
    if (!open) {
      props.onClose?.();
      setConfirmed(false);
    } else {
      setInvalidationCount(invalidationCount + 1);
    }
    setOpenState(open);
    props.onOpenChange?.(open);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} key={invalidationCount}>
      {props.trigger && <DialogTrigger asChild>
        {props.trigger}
      </DialogTrigger>}

      <DialogContent
        onInteractOutside={props.preventClose ? (e) => e.preventDefault() : undefined}
        className={props.preventClose ? "[&>button]:hidden" : ""}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <TitleIcon className="h-4 w-4 mr-2"/>
            {title}
          </DialogTitle>
          <DialogDescription>
            {props.description}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="pb-2">
          <div>
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
          </div>

          {props.confirmText && <Alert>
            <Label className="flex gap-4 items-center">
              <Checkbox id={confirmId} checked={confirmed} onCheckedChange={(v) => setConfirmed(!!v)}/>
              {props.confirmText}
            </Label>
          </Alert>}
        </DialogBody>


        {anyButton && <DialogFooter className="gap-2">
          {cancelButton && (
            <Button
              variant="secondary"
              color="neutral"
              onClick={async () => {
                if (await cancelButton.onClick?.() !== "prevent-close") {
                  onOpenChange(false);
                }
              }}
              {...cancelButton.props}
            >
              {cancelButton.label ?? "Cancel"}
            </Button>
          )}
          {okButton && (
            <Button
              disabled={!!props.confirmText && !confirmed}
              variant={props.danger ? "destructive" : "default"}
              onClick={async () => {
                if (await okButton.onClick?.() !== "prevent-close") {
                  onOpenChange(false);
                }
              }}
              {...okButton.props}
            >
              {okButton.label ?? "OK"}
            </Button>
          )}
        </DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
