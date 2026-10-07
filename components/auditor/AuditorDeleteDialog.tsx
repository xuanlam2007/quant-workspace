"use client";

import { useLayoutEffect, useRef } from "react";
import { Icon } from "./AuditorUi";
import styles from "../../app/auditor/auditor.module.css";

type Props = {
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  disabled: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function AuditorDeleteDialog({ title, description, confirmLabel, pending, disabled, error, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    cancel.current?.focus({ preventScroll: true });
    return () => {
      element?.close();
      if (origin?.isConnected && !origin.closest("[inert]")) {
        const target = origin.matches(":disabled") ? origin.closest("dialog")?.querySelector<HTMLElement>("button:not(:disabled)") : origin;
        target?.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <dialog
      id="auditor-delete-dialog"
      ref={dialog}
      className={styles.deleteDialog}
      role="alertdialog"
      aria-labelledby="auditor-delete-title"
      aria-describedby="auditor-delete-description"
      aria-busy={pending}
      onCancel={event => { event.preventDefault(); if (!pending) onCancel(); }}
      onClick={event => {
        if (event.target !== event.currentTarget || pending) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onCancel();
      }}
    >
      <div className={styles.deleteDialogHeading}>
        <span className={styles.deleteDialogIcon}><Icon name="warning" /></span>
        <button type="button" className={styles.iconButton} aria-label="Đóng xác nhận xóa" disabled={pending} onClick={onCancel}><Icon name="close" /></button>
      </div>
      <h2 id="auditor-delete-title">{title}</h2>
      <p id="auditor-delete-description">{description}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.deleteDialogActions}>
        <button ref={cancel} type="button" className={styles.button} disabled={pending} onClick={onCancel}>Hủy</button>
        <button type="button" className={`${styles.button} ${styles.sellButton}`} disabled={disabled} onClick={onConfirm}>{pending ? "Đang xóa..." : confirmLabel}</button>
      </div>
    </dialog>
  );
}
