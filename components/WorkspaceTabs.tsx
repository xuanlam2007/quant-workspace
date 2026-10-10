"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import ChartLoading from "./ui/ChartLoading";
import AuditorLoading from "./auditor/AuditorLoading";
import BacktestLoading from "./backtest/BacktestLoading";

const Chart = dynamic(() => import("./Chart"), { ssr: false, loading: () => <ChartLoading /> });
const Auditor = dynamic(() => import("./auditor/AuditorWorkspace"), { ssr: false, loading: () => <AuditorLoading /> });
const Backtest = dynamic(() => import("./backtest/BacktestWorkspace"), { ssr: false, loading: () => <BacktestLoading /> });

export function WorkspaceTabs() {
  const pathname = usePathname();
  const chartActive = pathname === "/";
  const auditorActive = pathname === "/auditor";
  const backtestActive = pathname === "/backtest";
  const [chartVisited, setChartVisited] = useState(chartActive);
  const [auditorVisited, setAuditorVisited] = useState(auditorActive);
  const [backtestVisited, setBacktestVisited] = useState(backtestActive);
  const chartRoot = useRef<HTMLDivElement>(null);
  const auditorRoot = useRef<HTMLDivElement>(null);
  const backtestRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const titles: Record<string, string> = {
      "/": "VN30 · live chart",
      "/auditor": "Analyzer Auditor · Quant Workspace",
      "/backtest": "Backtest · Quant Workspace",
    };
    if (titles[pathname]) document.title = titles[pathname];
  }, [pathname]);

  useEffect(() => {
    if (chartActive) setChartVisited(true);
    if (auditorActive) setAuditorVisited(true);
    if (backtestActive) setBacktestVisited(true);
    chartRoot.current?.toggleAttribute("inert", !chartActive);
    auditorRoot.current?.toggleAttribute("inert", !auditorActive);
    backtestRoot.current?.toggleAttribute("inert", !backtestActive);
  }, [chartActive, auditorActive, backtestActive]);

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
      {(backtestVisited || backtestActive) && (
        <div ref={backtestRoot} className="chart-workspace" aria-hidden={!backtestActive} data-active={backtestActive}>
          {backtestActive && <AppHeader />}
          <Backtest active={backtestActive} />
        </div>
      )}
    </>
  );
}
