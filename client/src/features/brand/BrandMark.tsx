import styles from './BrandMark.module.css';

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className={styles.mark}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path
        className={styles.frame}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 20v-6a4 4 0 0 1 4-4h8M47 10h8a4 4 0 0 1 4 4v6M59 40v6a4 4 0 0 1-4 4h-8M17 50H9a4 4 0 0 1-4-4v-6"
      />
      <path
        className={styles.bubble}
        d="M27 8h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-3.5L30 23.5V20h-3a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3z"
      />
      <circle className={styles.person} cx="20.5" cy="29" r="5.6" />
      <circle className={styles.person} cx="43.5" cy="29" r="5.6" />
      <path className={styles.person} d="M10 47c0-6.6 4.7-10.8 10.5-10.8S31 40.4 31 47z" />
      <path className={styles.person} d="M33 47c0-6.6 4.7-10.8 10.5-10.8S54 40.4 54 47z" />
    </svg>
  );
}
