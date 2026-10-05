"use client";

import { evidenceUrl, type AuditEvent, type Snapshot } from "../../lib/auditor-client";
import { Icon, points } from "./AuditorUi";
import styles from "../../app/auditor/auditor.module.css";

export default function AuditorFeed({ snapshot, events, total, ready, filter, query, onFilter, onQuery }: {
  snapshot: Snapshot | null; events: AuditEvent[]; total: number; ready: boolean;
  filter: string; query: string; onFilter: (value: string) => void; onQuery: (value: string) => void;
}) {
  const summary = snapshot?.summary;
  return <div className={styles.auditArea}>
    <section className={styles.panel}>
      <div className={styles.sectionHeading}><div><h2>Audit feed</h2><p className={styles.help}>Decisions, evidence, and strategy feedback.</p></div><span className={styles.muted}>{total} events</span></div>
      <div className={styles.feedControls}>
        <div className={styles.tabs} aria-label="Event filters">{[["all", "All events"], ["tests", "Decisions"], ["warnings", "Warnings"], ["rejects", "Rejected"]].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => onFilter(value)}>{label}</button>)}</div>
        <input type="search" aria-label="Search audit events" placeholder="Search events..." value={query} onChange={event => onQuery(event.target.value)} />
      </div>
      <div className={styles.feed}>
        {!events.length ? <div className={styles.empty}><Icon name="activity" /><h3>{!ready && !snapshot ? "Waiting for session data" : total ? "No matching events" : "Your audit trail starts here"}</h3><p>{total ? "Try another filter or clear your search." : snapshot?.session_id ? "Save a decision to review its thesis, warnings, and evidence." : "Create or select a session to begin recording."}</p>{total > 0 && <button type="button" className={styles.button} onClick={() => { onQuery(""); onFilter("all"); }}>Clear filters</button>}</div> : events.map(event => <article className={styles.event} key={event.id}>
          <div className={styles.eventMeta}><time className={styles.mono}>{event.timestamp}</time><span className={`${styles.badge} ${["BUY", "LONG"].includes(event.action || "") ? styles.positive : ["SELL", "SHORT"].includes(event.action || "") ? styles.negative : styles.muted}`}>{event.type === "DECISION_TEST" ? event.action || "Decision" : event.action || event.type.replaceAll("_", " ")}</span>{event.price !== undefined && <strong className={styles.mono}>{event.price.toLocaleString("en-US")} <small>pts</small></strong>}{event.contracts && <small className={styles.muted}>{event.contracts} contract{event.contracts !== 1 ? "s" : ""}</small>}</div>
          {(event.voice_transcript || event.reason) && <p className={styles.rationale}>{event.voice_transcript || event.reason}</p>}
          {!!event.warnings?.length && <div className={styles.warnings}>{event.warnings.map((warning, index) => <p key={`${warning.type}-${index}`}><Icon name="warning" /><span>{warning.message}</span></p>)}</div>}
          {event.ai_pending ? <p className={styles.aiNote}>AGY analysis pending...</p> : event.ai_error ? <p className={`${styles.aiNote} ${styles.warning}`}>Analysis unavailable: {event.ai_error}</p> : event.ai_thesis ? <div className={styles.aiNote}><span>AGY</span><p>{event.ai_thesis}</p></div> : null}
          {(event.frame_path || event.drawing_data) && <details className={styles.evidence}><summary>View evidence</summary>{event.frame_path && <a href={evidenceUrl(event, snapshot!.current_date, snapshot!.session_id)} target="_blank" rel="noreferrer"><img src={evidenceUrl(event, snapshot!.current_date, snapshot!.session_id)} alt={`Chart capture at ${event.timestamp}`} loading="lazy" /></a>}{event.drawing_data && <pre>{JSON.stringify(event.drawing_data, null, 2)}</pre>}</details>}
        </article>)}
      </div>
      <p className={styles.feedFooter}>{events.length} of {total} recent events · Newest first</p>
    </section>
    <section className={styles.panel}>
      <div className={styles.sectionHeading}><h2>Closed trade pairs</h2><span className={styles.muted}>{summary?.total_closed_pairs || 0} completed</span></div>
      {summary?.pairs?.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Opened</th><th>Closed</th><th>BUY price</th><th>SELL price</th><th>Gross pts</th><th>Net pts</th></tr></thead><tbody>{summary.pairs.map((pair, index) => <tr key={`${pair.open_time}-${pair.close_time}-${index}`}><td>{pair.open_time}</td><td>{pair.close_time}</td><td>{points(pair.p_green)}</td><td>{points(pair.p_red)}</td><td>{points(pair.gross_points, true)}</td><td className={pair.net_points < 0 ? styles.negative : styles.positive}>{points(pair.net_points, true)}</td></tr>)}</tbody></table></div> : <div className={styles.tableEmpty}>Completed BUY/SELL pairs will appear here with their result after fees.</div>}
    </section>
  </div>;
}

