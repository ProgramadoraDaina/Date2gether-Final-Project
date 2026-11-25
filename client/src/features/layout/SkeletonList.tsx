import styles from './States.module.css';

export function SkeletonList({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className={styles.skeleton} role="status" aria-live="polite">
      <span className={styles.srOnly}>{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.skeletonRow} aria-hidden="true">
          <span className={`${styles.bar} ${styles.square}`} />
          <span className={styles.lines}>
            <span className={styles.bar} />
            <span className={`${styles.bar} ${styles.short}`} />
          </span>
        </div>
      ))}
    </div>
  );
}
