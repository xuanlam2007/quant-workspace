import type { Metadata } from "next";
import AuditorWorkspace from "../../components/auditor/AuditorWorkspace";

export const metadata: Metadata = {
  title: "Quant Strategy Auditor",
  description: "Review trading decisions, strategy warnings, and session results.",
};

export default function AuditorPage() {
  return <AuditorWorkspace />;
}
