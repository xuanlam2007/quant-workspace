import { useState } from "react";
import { LoadingIndicator, LoadingText, Skeleton } from "../ui/Loading";
import styles from "../../app/auditor/auditor.module.css";

type Props = {
  notes: string;
  enabled: boolean;
  disabled: boolean;
  saving: boolean;
  loading: boolean;
  toggling: boolean;
  onSave: (notes: string) => void;
  onToggle: (enabled: boolean) => void;
};

export default function AuditorStrategy({ notes, enabled, disabled, saving, loading, toggling, onSave, onToggle }: Props) {
  const [draft, setDraft] = useState(notes);

  return (
    <section className={styles.panel} aria-labelledby="auditor-strategy-title">
      <h2 id="auditor-strategy-title">Chiến lược của bạn</h2>
      <p className={styles.help}>Bạn tự xác định quy tắc. Hệ thống không tự đặt giờ giao dịch, thời điểm vào lệnh hoặc giới hạn số lệnh.</p>
      <div className={styles.field}>
        <label htmlFor="auditor-strategy">Quy tắc chiến lược</label>
        <div className={styles.strategyEditor} data-loading={loading} aria-busy={loading}><textarea
          id="auditor-strategy"
          rows={6}
          maxLength={20000}
          value={draft}
          disabled={disabled || loading}
          aria-hidden={loading}
          placeholder="Mô tả điều kiện vào lệnh, thoát lệnh và quản lý rủi ro bằng lời của bạn."
          onChange={event => setDraft(event.target.value)}
        />{loading && <div className={styles.loadingTextarea}><LoadingText width="91%" /><LoadingText width="77%" delay={40} /><LoadingText width="84%" delay={80} /><LoadingText width="58%" delay={120} /></div>}</div>
      </div>
      <p className={styles.help}>AGY đánh giá lệnh giả lập theo nội dung này và minh chứng hiện có. Thông tin chưa đủ sẽ chưa có kết luận. Việc ghi thao tác chuột vẫn độc lập với đánh giá chiến lược.</p>
      <button
        type="button"
        className={`${styles.button} ${styles.fullWidth}`}
        disabled={disabled || loading || draft.trim() === notes}
        onClick={() => onSave(draft)}
      >
        {loading ? <LoadingText width="12ch" /> : saving ? <LoadingIndicator label="Đang lưu chiến lược" /> : draft.trim() ? "Lưu chiến lược" : "Xóa chiến lược"}
      </button>
      <div className={styles.guardrail}>
        <label className={styles.toggle}>
          {loading ? <Skeleton width={18} height={18} /> : <input
            type="checkbox"
            checked={enabled}
            disabled={disabled || !notes}
            onChange={event => onToggle(event.target.checked)}
          />}
          <span><strong>Đánh giá chiến lược</strong><small>{loading ? <LoadingText width="19ch" /> : toggling ? <LoadingIndicator label="Đang cập nhật" /> : notes ? "Phân tích theo quy tắc đã lưu" : "Lưu chiến lược để bật đánh giá"}</small></span>
        </label>
      </div>
    </section>
  );
}
