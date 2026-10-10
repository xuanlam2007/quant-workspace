import { useEffect, useRef, useState } from "react";
import { auditorRequest, type AiCatalog, type AiCatalogOption, type AiSettings, type AiStatus } from "../../lib/auditor-client";
import { LoadingIndicator, LoadingNumber, LoadingText } from "../ui/Loading";
import { AuditorSelect, Icon } from "./AuditorUi";
import AuditorNotice from "./AuditorNotice";
import StarBorder from "../ui/reactbits/StarBorder";
import styles from "../../app/auditor/auditor.module.css";

export default function AuditorConnection({ status, loading, pending, disabled, observing = false, onSave, onCheck, onOpenTerminal }: {
  status: AiStatus | null; loading: boolean; pending: string; disabled: boolean;
  observing?: boolean;
  onSave: (settings: AiSettings) => void; onCheck: () => void;
  onOpenTerminal: (provider: AiSettings["provider"]) => void;
}) {
  const [provider, setProvider] = useState<AiSettings["provider"]>("AGY");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [catalog, setCatalog] = useState<AiCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const lastRefreshKey = useRef(0);
  const hasStatus = !!status;
  useEffect(() => {
    setProvider(status?.provider || "AGY"); setModel(status?.model || "");
    setEffort(status?.provider === "CODEX" ? status?.effort || "" : "");
  }, [status?.provider, status?.model, status?.effort]);

  useEffect(() => {
    if (loading || !hasStatus) return;
    const controller = new AbortController();
    const refresh = refreshKey !== lastRefreshKey.current || status?.connected === true;
    lastRefreshKey.current = refreshKey;
    setCatalogLoading(true); setCatalogError("");
    void auditorRequest<AiCatalog>(`/ai/catalog?provider=${provider}&refresh=${refresh}`, undefined, "GET", controller.signal)
      .then(result => { if (!controller.signal.aborted) setCatalog(result); })
      .catch(error => { if (!controller.signal.aborted) setCatalogError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [provider, loading, hasStatus, status?.connected, refreshKey]);

  const selectedCatalog = catalog?.provider === provider ? catalog : null;
  const models = selectedCatalog?.models || [];
  const selectedModel = model ? models.find(option => option.id === model) : models.find(option => option.is_default);
  const modelChoices = Array.from(new Map(models.map(item => {
    const choice = provider === "AGY" && item.preset_group ? item.preset_group : item;
    return [choice.id, choice] as const;
  })).values());
  const modelValue = provider === "AGY" ? selectedModel?.preset_group?.id || model : model;
  const presetGroup = provider === "AGY" ? selectedModel?.preset_group : undefined;
  const efforts = provider === "AGY"
    ? presetGroup ? models.filter(item => item.preset_group?.id === presetGroup.id && item.preset_effort).map(item => ({ id: item.id, label: item.preset_effort! })) : []
    : selectedModel?.efforts || [];
  const invalidModel = !!model && !models.some(option => option.id === model);
  const invalidEffort = provider === "CODEX" && !!effort && !efforts.some(option => option.id === effort);
  const invalid = invalidModel || invalidEffort;
  const changed = provider !== (status?.provider || "AGY") || model !== (status?.model || "") || (provider === "CODEX" && effort !== (status?.effort || ""));
  const options = (items: AiCatalogOption[], value: string) => [
    ...(value && !items.some(item => item.id === value) ? [{ value, label: `${value} (đã lưu, chưa xác nhận)`, disabled: true }] : []),
    ...items.map(item => ({ value: item.id, label: item.label })),
  ];
  const choicesLoading = loading || catalogLoading;
  const effortValue = provider === "AGY" ? presetGroup ? model : "" : effort;
  const checking = loading || pending === "ai";
  const working = !changed && !!status?.connected && observing;
  const connectionLabel = checking ? "Đang kiểm tra" : changed ? "Chưa lưu cấu hình" : working ? "Đang quan sát" : status?.connected ? "Đã kết nối" : status?.connected === false ? "Chưa kết nối" : "Chưa kiểm tra";

  return <section className={styles.panel} aria-labelledby="auditor-ai-title">
    <div className={styles.sectionHeading}><h2 id="auditor-ai-title">Kết nối AI</h2><StarBorder active={checking || working} className={styles.aiActivity} contentClassName={styles.aiActivityContent}><span role="status" data-connected={!changed && !!status?.connected}>{checking || working ? <Icon name="activity" /> : <span className={styles.dot} aria-hidden="true" />}{connectionLabel}</span></StarBorder></div>
    <div className={styles.field}><label htmlFor="auditor-provider">CLI</label><AuditorSelect<AiSettings["provider"]> id="auditor-provider" label="CLI" value={provider} options={[{ value: "AGY", label: "AGY CLI" }, { value: "CODEX", label: "Codex CLI" }]} disabled={disabled} loading={loading} onChange={value => { setProvider(value); setModel(""); setEffort(""); setCatalog(null); setCatalogLoading(true); }} /></div>
    <div className={styles.field}>
      <label htmlFor="auditor-model">Model</label>
      <div className={styles.inputAction}>
        <AuditorSelect id="auditor-model" label="Model" value={modelValue} options={[{ value: "", label: `Mặc định CLI${models.find(item => item.is_default) ? ` (${models.find(item => item.is_default)!.label})` : ""}` }, ...options(modelChoices, modelValue)]} disabled={disabled} loading={choicesLoading} onChange={value => { setModel(value); setEffort(""); }} />
        <button type="button" className={styles.iconButton} aria-label="Làm mới model" title="Làm mới model" aria-busy={choicesLoading} disabled={disabled || choicesLoading} onClick={() => { setCatalogLoading(true); setRefreshKey(value => value + 1); }}>{choicesLoading ? <LoadingIndicator compact label="Đang tải model" /> : <Icon name="refresh" />}</button>
      </div>
    </div>
    <div className={styles.field}>
      <label htmlFor="auditor-effort">Effort</label>
      <AuditorSelect id="auditor-effort" label="Effort" value={effortValue} options={[
        ...(!efforts.length ? [{ value: "", label: "Không có" }] : provider === "CODEX" ? [{ value: "", label: `Mặc định CLI${selectedModel?.default_effort ? ` (${selectedModel.default_effort})` : ""}` }] : []),
        ...options(efforts, effortValue),
      ]} disabled={disabled || !efforts.length} loading={choicesLoading} onChange={value => { if (provider === "AGY") setModel(value); else setEffort(value); }} />
    </div>
    {selectedCatalog && !choicesLoading && provider === "CODEX" && !efforts.length && <p className={styles.help}>Chọn model để xem effort mà CLI hỗ trợ, hoặc dùng mặc định CLI.</p>}
    {(catalogError || Object.keys(selectedCatalog?.errors || {}).length > 0) && <AuditorNotice message={`${catalogError || Object.values(selectedCatalog!.errors).join(" ")} Mở Terminal để đăng nhập hoặc kiểm tra CLI, rồi làm mới danh sách.`} />}
    {!choicesLoading && invalid && <AuditorNotice kind="warning" message="Một lựa chọn đã lưu không có trong danh sách hiện tại. Chọn lại hoặc dùng mặc định CLI trước khi lưu và kiểm tra kết nối." />}
    <div className={styles.connectionActions}>
      <button type="button" className={styles.button} disabled={disabled || choicesLoading || !changed || invalid} onClick={() => onSave({ provider, model, effort: provider === "CODEX" ? effort : "" })}>{pending === "ai-config" ? <LoadingIndicator label="Đang lưu kết nối" /> : "Lưu cấu hình"}</button>
      <button type="button" className={styles.button} disabled={disabled || choicesLoading || changed || invalid} onClick={onCheck}>{pending === "ai" ? <LoadingIndicator label="Đang kiểm tra" /> : "Kiểm tra kết nối"}</button>
      <button type="button" className={styles.button} disabled={disabled || loading} onClick={() => onOpenTerminal(provider)}><Icon name="terminal" />Mở Terminal</button>
    </div>
    <p className={styles.help}>Model và effort được tách tự động từ danh sách CLI. Model không có lựa chọn effort sẽ hiển thị Không có. AGY ánh xạ lựa chọn về đúng mã model của CLI; Codex dùng effort riêng theo model. Quản lý tài khoản trong Terminal của CLI đã chọn. Sau khi đổi tài khoản, làm mới model và kiểm tra kết nối lại.</p>
    <p className={styles.help}>Sau khi kiểm tra kết nối, minh chứng được gửi đến dịch vụ AI đã chọn để quan sát và ghi nhớ phong cách trader. Chỉ gửi tài liệu chiến lược khi bạn bật đối chiếu.</p>
    {loading ? <LoadingText width="90%" /> : <p className={styles.help}>{provider === "AGY" ? "AGY nhận ảnh và ghi âm qua trình đọc minh chứng của CLI." : "Codex nhận ghi âm và ảnh đính kèm qua app-server của CLI."} Model đã chọn chép lời và quan sát minh chứng, kể cả khi tắt chiến lược. Model cần hỗ trợ âm thanh; kiểm tra kết nối chỉ xác nhận phản hồi văn bản. Nếu xử lý thất bại, thử lại từ nhật ký.</p>}
    {!changed && status?.error && <AuditorNotice message={status.error} />}
    {!changed && (pending === "ai" || status?.latency_ms !== undefined) && <p className={styles.help}>Độ trễ: <LoadingNumber loading={pending === "ai"} digits={3}>{status?.latency_ms}</LoadingNumber> ms</p>}
  </section>;
}
