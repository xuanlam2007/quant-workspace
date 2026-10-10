import { LoadingIndicator, LoadingText, Skeleton } from "../ui/Loading";
import AuditorNotice from "./AuditorNotice";
import styles from "../../app/auditor/auditor.module.css";

type Props = {
  enabled: boolean; available: boolean; documents: string[]; error?: string;
  disabled: boolean; loading: boolean; toggling: boolean;
  onToggle: (enabled: boolean) => void;
};

export default function AuditorStrategy({ enabled, available, documents, error, disabled, loading, toggling, onToggle }: Props) {
  return <section className={styles.panel} aria-labelledby="auditor-strategy-title">
    <h2 id="auditor-strategy-title">Chiến lược tham chiếu</h2>
    <div className={styles.guardrail}><label className={styles.toggle}>
      {loading ? <Skeleton width={18} height={18} /> : <input type="checkbox" checked={enabled} disabled={disabled || (!available && !enabled)} onChange={event => onToggle(event.target.checked)} />}
      <span><strong>Sử dụng chiến lược của bạn</strong><small>{loading ? <LoadingText width="19ch" /> : toggling ? <LoadingIndicator label="Đang cập nhật" /> : enabled ? "Đối chiếu với tài liệu đã lưu" : "Quan sát và ghi nhớ phong cách trader"}</small></span>
    </label></div>
    <p className={styles.help}>Tắt đối chiếu vẫn cho phép AI quan sát minh chứng, ghi nhận lý do và phong cách giao dịch. Bật đối chiếu để so sánh thêm với chiến lược; khác tài liệu chưa có nghĩa là vi phạm.</p>
    {loading ? <LoadingText width="24ch" /> : documents.length ? <p className={styles.help}>Tài liệu: {documents.join(", ")}</p> : <p className={styles.help}>Chưa có tài liệu chiến lược. AI vẫn có thể quan sát ảnh, âm thanh và thao tác khi đã kết nối.</p>}
    <p className={styles.help}>Tài liệu thêm hoặc sửa được tự nhận diện. Việc thêm tài liệu không tự bật đối chiếu.</p>
    {error && <AuditorNotice message={error} />}
  </section>;
}
