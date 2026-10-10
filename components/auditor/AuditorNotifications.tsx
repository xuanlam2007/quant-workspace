"use client";

import GlobalNotice from "../ui/GlobalNotice";
export type AuditorNotification = { id: number; kind: "success" | "error"; text: string };
export default function AuditorNotifications({ notices, onDismiss }: { notices: AuditorNotification[]; onDismiss: (id: number) => void; modalId?: string }) {
  return <>{notices.map(notice => <GlobalNotice key={notice.id} message={notice.text} kind={notice.kind} onDismiss={() => onDismiss(notice.id)} />)}</>;
}
