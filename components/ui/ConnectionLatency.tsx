import { LoadingText } from "./Loading";

export default function ConnectionLatency({ value, loading = false }: { value?: number; loading?: boolean }) {
  const measured = typeof value === "number" && Number.isFinite(value) && value >= 0;
  return <LoadingText loading={loading} width="9ch"><span className="connection-latency" data-measured={measured}>
    {measured ? <>{value}<span className="connection-latency__unit"> ms</span></> : "Chưa kiểm tra"}
  </span></LoadingText>;
}
