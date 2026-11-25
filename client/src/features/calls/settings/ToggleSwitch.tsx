'use client';

import styles from './CallSettings.module.css';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  'aria-label': string;
  'data-testid'?: string;
}

// Switch tipo pill accesible: checkbox real pero visualmente oculto (mismo
// patrón que .option input en CallSettings.module.css para los radio
// buttons), con el track/thumb dibujados en CSS encima.
export function ToggleSwitch({
  checked,
  onChange,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: ToggleSwitchProps) {
  return (
    <label className={styles.switch}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel}
        data-testid={testId}
      />
      <span className={styles.switchTrack}>
        <span className={styles.switchThumb} />
      </span>
    </label>
  );
}
