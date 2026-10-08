"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import ChartLoading from "./ui/ChartLoading";
import AuditorLoading from "./auditor/AuditorLoading";

const Chart = dynamic(() => import("./Chart"), { ssr: false, loading: () => <ChartLoading /> });
const Auditor = dynamic(() => import("./auditor/AuditorWorkspace"), { ssr: false, loading: () => <AuditorLoading /> });

export function WorkspaceTabs() {
  const pathname = usePathname();
  const chartActive = pathname === "/";
  const auditorActive = pathname === "/auditor";
  const [chartVisited, setChartVisited] = useState(chartActive);
  const [auditorVisited, setAuditorVisited] = useState(auditorActive);
  const chartRoot = useRef<HTMLDivElement>(null);
  const auditorRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chartActive) setChartVisited(true);
    if (auditorActive) setAuditorVisited(true);
    chartRoot.current?.toggleAttribute("inert", !chartActive);
    auditorRoot.current?.toggleAttribute("inert", !auditorActive);
  }, [chartActive, auditorActive]);

  return (
    <>
      {(chartVisited || chartActive) && (
        <div ref={chartRoot} className="chart-workspace" aria-hidden={!chartActive} data-active={chartActive}>
          <Chart active={chartActive} />
        </div>
      )}
      {(auditorVisited || auditorActive) && (
        <div ref={auditorRoot} className="chart-workspace" aria-hidden={!auditorActive} data-active={auditorActive}>
          {auditorActive && <AppHeader />}
          <Auditor active={auditorActive} />
        </div>
      )}
    </>
  );
}
