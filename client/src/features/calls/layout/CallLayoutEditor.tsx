'use client';

import { useMemo } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import { buildLayoutTree, type LayoutZone, type TileAspect, type ZonePlacement } from './layout';
import { LayoutView } from './LayoutView';
import { useCallLayoutStore } from './store';
import styles from './CallLayout.module.css';

const PLACEMENTS: { value: ZonePlacement; label: string }[] = [
  { value: 'beside-previous', label: 'Al lado de la anterior' },
  { value: 'below-previous', label: 'Abajo de la anterior' },
  { value: 'left', label: 'A la izquierda' },
  { value: 'right', label: 'A la derecha' },
  { value: 'top', label: 'Arriba' },
  { value: 'bottom', label: 'Abajo' },
];

const ASPECTS: { value: TileAspect; label: string }[] = [
  { value: '16:9', label: 'Alargada (16:9)' },
  { value: '4:3', label: 'Clásica (4:3)' },
  { value: '1:1', label: 'Cuadrada (1:1)' },
  { value: '9:16', label: 'Vertical (9:16)' },
];

function RangeField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.field}>
      <span>
        {label}: {value}
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function ZoneFields({ zone, index }: { zone: LayoutZone; index: number }) {
  const { t } = useTranslation();
  const { updateZone, removeZone } = useCallLayoutStore();
  const update = (changes: Partial<LayoutZone>) => updateZone(zone.id, changes);
  const title = `${t('Zona')} ${index + 1}`;

  return (
    <fieldset className={styles.zoneCard} aria-label={title}>
      <legend className={styles.zoneHead}>
        <span>{title}</span>
        <button
          type="button"
          className={`secondary ${styles.smallButton}`}
          onClick={() => removeZone(zone.id)}
        >
          {t('Quitar zona')}
        </button>
      </legend>
      {index === 0 ? (
        <p className={styles.hint}>{t('Ocupa el espacio que queda')}</p>
      ) : (
        <>
          <label className={styles.field}>
            <span>{t('Posición')}</span>
            <select
              aria-label={t('Posición')}
              value={zone.placement}
              onChange={(e) => update({ placement: e.target.value as ZonePlacement })}
            >
              {PLACEMENTS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          <RangeField
            label={t('Ancho (%)')}
            value={zone.width}
            min={10}
            max={100}
            onChange={(width) => update({ width })}
          />
          <RangeField
            label={t('Alto (%)')}
            value={zone.height}
            min={10}
            max={100}
            onChange={(height) => update({ height })}
          />
        </>
      )}
      <label className={styles.field}>
        <span>{t('Personas')}</span>
        <input
          type="number"
          aria-label={t('Personas')}
          min={1}
          max={50}
          value={zone.capacity}
          onChange={(e) => update({ capacity: Number(e.target.value) })}
        />
      </label>
      <RangeField
        label={t('Tamaño (%)')}
        value={zone.scale}
        min={30}
        max={100}
        onChange={(scale) => update({ scale })}
      />
      <label className={styles.field}>
        <span>{t('Forma')}</span>
        <select
          aria-label={t('Forma')}
          value={zone.aspect}
          onChange={(e) => update({ aspect: e.target.value as TileAspect })}
        >
          {ASPECTS.map(({ value, label }) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

export function CallLayoutEditor({ showPreview = true }: { showPreview?: boolean }) {
  const { t } = useTranslation();
  const { enabled, zones, setEnabled, addZone } = useCallLayoutStore();
  const tree = useMemo(() => buildLayoutTree(zones), [zones]);
  const zoneNumber = new Map(zones.map((zone, index) => [zone.id, index + 1]));

  return (
    <div className={styles.editor}>
      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          aria-label={t('Usar mi distribución en las llamadas')}
        />
        <span>{t('Usar mi distribución en las llamadas')}</span>
      </label>
      <p className={styles.editorHint}>
        {t(
          'Las personas van llenando la Zona 1, después la 2, y así. Las que no entran van a la última.',
        )}
      </p>
      {tree && showPreview && (
        <div className={styles.preview} data-testid="layout-preview">
          <LayoutView
            tree={tree}
            renderZone={(zone) => (
              <span className={styles.previewZone}>
                {zoneNumber.get(zone.id)} · {zone.capacity} {t('personas')}
              </span>
            )}
          />
        </div>
      )}
      <ul className={styles.zoneList}>
        {zones.map((zone, index) => (
          <li key={zone.id}>
            <ZoneFields zone={zone} index={index} />
          </li>
        ))}
      </ul>
      <button type="button" className={`secondary ${styles.smallButton}`} onClick={addZone}>
        {t('Agregar zona')}
      </button>
    </div>
  );
}
