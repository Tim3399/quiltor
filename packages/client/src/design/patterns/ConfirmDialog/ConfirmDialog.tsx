import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { Button } from "../../primitives/Button";
import "./ConfirmDialog.css";

export const IRREVERSIBLE_HOLD_MS = 1500;

export interface ConfirmDialogHoldLabels {
  accessible: string;
  idle: string;
  active: string;
}

interface ConfirmDialogCommonProps {
  open?: boolean;
  title: string;
  description: ReactNode;
  supportingText?: ReactNode;
  closeLabel: string;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export interface ClickConfirmDialogProps extends ConfirmDialogCommonProps {
  confirmation?: "click";
  holdDurationMs?: never;
  holdLabels?: never;
}

export interface HoldConfirmDialogProps extends ConfirmDialogCommonProps {
  confirmation: "hold";
  holdDurationMs: number;
  holdLabels: ConfirmDialogHoldLabels;
}

export type ConfirmDialogProps = ClickConfirmDialogProps | HoldConfirmDialogProps;

export function ConfirmDialog(props: ConfirmDialogProps) {
  const {
    open = true,
    title,
    description,
    supportingText,
    closeLabel,
    cancelLabel,
    confirmLabel,
    onConfirm,
    onClose,
  } = props;
  const descriptionId = useId();
  const supportingTextId = useId();
  const complete = () => {
    onConfirm();
    onClose();
  };

  return (
    <Dialog
      open={open}
      title={title}
      closeLabel={closeLabel}
      onClose={onClose}
      role="alertdialog"
      describedById={
        supportingText !== undefined ? `${descriptionId} ${supportingTextId}` : descriptionId
      }
      footer={
        <>
          <Button data-autofocus onClick={onClose}>
            {cancelLabel}
          </Button>
          {props.confirmation === "hold" ? (
            <HoldButton
              labels={props.holdLabels}
              duration={props.holdDurationMs}
              onComplete={complete}
            />
          ) : (
            <Button appearance="primary" tone="danger" onClick={complete}>
              {confirmLabel}
            </Button>
          )}
        </>
      }
    >
      <div className="ui-confirm-dialog__message">
        <AlertTriangle className="ui-confirm-dialog__icon" aria-hidden="true" />
        <div className="ui-confirm-dialog__copy">
          <div id={descriptionId} className="ui-confirm-dialog__description">
            {description}
          </div>
          {supportingText !== undefined && (
            <div id={supportingTextId} className="ui-confirm-dialog__supporting-text">
              {supportingText}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function HoldButton({
  labels,
  duration,
  onComplete,
}: {
  labels: ConfirmDialogHoldLabels;
  duration: number;
  onComplete: () => void;
}) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null);
  const completed = useRef(false);

  const cancel = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    setStartedAt(null);
    setProgress(0);
  };

  const start = () => {
    if (startedAt !== null || completed.current) return;
    const startTime = performance.now();
    const safeDuration = Math.max(1, duration);
    setStartedAt(startTime);
    setProgress(0);
    timer.current = window.setInterval(() => {
      const next = Math.min(1, (performance.now() - startTime) / safeDuration);
      setProgress(next);
      if (next >= 1 && !completed.current) {
        completed.current = true;
        if (timer.current !== null) window.clearInterval(timer.current);
        timer.current = null;
        onComplete();
      }
    }, 40);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    },
    [],
  );

  return (
    <Button
      className="ui-confirm-dialog__hold"
      appearance="primary"
      tone="danger"
      aria-label={labels.accessible}
      data-holding={startedAt !== null || undefined}
      style={{ "--hold-progress": progress } as React.CSSProperties}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        start();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") cancel();
      }}
      onBlur={cancel}
    >
      {startedAt === null ? labels.idle : labels.active}
    </Button>
  );
}
