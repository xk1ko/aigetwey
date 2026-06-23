"use client";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export function ConfirmModal({ title, message, confirmLabel = "Delete", onConfirm, onCancel, busy }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-brand-lg border border-border bg-surface p-5 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-danger/10 text-danger">
            <Icon name="warning" size={16} />
          </span>
          <h2 className="text-[15px] font-semibold text-text">{title}</h2>
        </div>
        <p className="mb-4 text-[12.5px] text-text-muted">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
