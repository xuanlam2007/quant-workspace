"use client";

import { AuditorSelect } from "../../auditor/AuditorUi";

export function ChartSelect<T extends string | number>({ id, label, value, options, disabled = false, onChange }: {
  id: string; label: string; value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  disabled?: boolean; onChange: (value: T) => void;
}) {
  return <AuditorSelect id={id} label={label} value={value} options={options} disabled={disabled} variant="chart" onChange={onChange} />;
}
