import { engineStartHandler } from "@/lib/server/engine-launch";
export const runtime = "nodejs";
export const POST = engineStartHandler("auditor");
