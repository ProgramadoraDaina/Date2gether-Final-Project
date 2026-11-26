'use client';

import { useMemo, type ReactNode } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import { ToggleSwitch } from '../settings/ToggleSwitch';
import { buildLayoutTree, type LayoutZone, type TileAspect, type ZonePlacement } from './layout';
import { LayoutView } from './LayoutView';
import { useCallLayoutStore } from './store';
import { zoneColorStyle } from './zoneColors';
import { LAYOUT_PRESETS } from './presets';
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

// Highlighted rect (x, y, w, h) inside a 24x16 frame for each placement.
const PLACEMENT_SHAPES: Record<ZonePlacement, [number, number, number, number][]> = {
  'beside-previous': [[13, 9, 9, 5]],
  'below-previous': [[2, 11, 9, 3]],
  left: [[2, 2, 7, 12]],
  right: [[15, 2, 7, 12]],
  top: [[2, 2, 20, 4]],
  bottom: [[2, 10, 20, 4]],
};

function PlacementIcon({ placement }: { placement: ZonePlacement }) {
  const relative = placement === 'beside-previous' || placement === 'below-previous';
  return (
    <svg viewBox="0 0 24 16" width="30" height="20" aria-hidden="true">
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="15"
        fill="none"
        stroke="currentColor"
        opacity="0.5"
      />
      {relative && (
        <rect
          x={placement === 'beside-previous' ? 2 : 2}
          y={placement === 'beside-previous' ? 9 : 2}
          width={placement === 'beside-previous' ? 10 : 9}
          height={placement === 'beside-previous' ? 5 : 8}
          fill="none"
          stroke="currentColor"
          strokeDasharray="1.5 1"
        />
      )}
      {PLACEMENT_SHAPES[placement].map(([x, y, w, h]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}

function AspectIcon({ aspect }: { aspect: TileAspect }) {
  const [w, h] = aspect.split(':').map(Number);
  const scale = 14 / Math.max(w, h);
  const width = w * scale;
  const height = h * scale;
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <rect
        x={(16 - width) / 2}
        y={(16 - height) / 2}
        width={width}
        height={height}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

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
    <label className={styles.rangeField}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.rangeRow}>
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output className={styles.valueChip}>{value}%</output>
      </span>
    </label>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.stepper}>
      <button
        type="button"
        aria-label={t('Una persona menos')}
        onClick={() => onChange(value - 1)}
        disabled={value <= 1}
      >
        −
      </button>
      <input
        type="number"
        aria-label={t('Personas')}
        min={1}
        max={50}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button
        type="button"
        aria-label={t('Una persona más')}
        onClick={() => onChange(value + 1)}
        disabled={value >= 50}
      >
        +
      </button>
    </div>
  );
}

function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  renderIcon,
  showText,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  renderIcon: (value: T) => ReactNode;
  showText?: (value: T) => string;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.fieldBlock}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.choices} role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            aria-label={t(option.label)}
            title={t(option.label)}
            className={styles.choice}
            onClick={() => onChange(option.value)}
          >
            {renderIcon(option.value)}
            {showText && <span className={styles.choiceText}>{showText(option.value)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function zoneSummary(zone: LayoutZone, index: number, t: (key: string) => string) {
  const where =
    index === 0
      ? t('Ocupa el espacio que queda')
      : t(PLACEMENTS.find((p) => p.value === zone.placement)?.label ?? '');
  return `${where} · ${zone.capacity} ${t('pers.')} · ${zone.aspect}`;
}

function ZoneCard({ zone, index, open }: { zone: LayoutZone; index: number; open: boolean }) {
  const { t } = useTranslation();
  const { updateZone, removeZone, setFocusedZone } = useCallLayoutStore();
  const update = (changes: Partial<LayoutZone>) => updateZone(zone.id, changes);
  const title = `${t('Zona')} ${index + 1}`;

  return (
    <section
      className={styles.zoneCard}
      data-open={open}
      style={zoneColorStyle(index)}
      role="group"
      aria-label={title}
    >
      <div className={styles.zoneHead}>
        <button
          type="button"
          className={styles.zoneToggle}
          aria-expanded={open}
          onClick={() => setFocusedZone(open ? null : zone.id)}
        >
          <span className={styles.zoneBadge} style={zoneColorStyle(index)} data-testid="zone-badge">
            {index + 1}
          </span>
          <span className={styles.zoneTitle}>
            <strong>{title}</strong>
            <span className={styles.zoneSummary}>{zoneSummary(zone, index, t)}</span>
          </span>
          <span className={styles.chevron} aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
        </button>
        <button
          type="button"
          className={styles.removeZone}
          aria-label={t('Quitar zona')}
          title={t('Quitar zona')}
          onClick={() => removeZone(zone.id)}
        >
          ×
        </button>
      </div>
      {open && (
        <div className={styles.zoneBody}>
          {index === 0 ? (
            <p className={styles.hint}>{t('Ocupa el espacio que queda')}</p>
          ) : (
            <>
              <ChoiceGroup
                label={t('Posición')}
                options={PLACEMENTS}
                value={zone.placement}
                onChange={(placement) => update({ placement })}
                renderIcon={(placement) => <PlacementIcon placement={placement} />}
              />
              <div className={styles.fieldPair}>
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
              </div>
            </>
          )}
          <div className={styles.fieldBlock}>
            <span className={styles.fieldLabel}>{t('Personas')}</span>
            <Stepper value={zone.capacity} onChange={(capacity) => update({ capacity })} />
          </div>
          <ChoiceGroup
            label={t('Forma del video')}
            options={ASPECTS}
            value={zone.aspect}
            onChange={(aspect) => update({ aspect })}
            renderIcon={(aspect) => <AspectIcon aspect={aspect} />}
            showText={(aspect) => aspect}
          />
          <RangeField
            label={t('Tamaño (%)')}
            value={zone.scale}
            min={30}
            max={100}
            onChange={(scale) => update({ scale })}
          />
        </div>
      )}
    </section>
  );
}

export function CallLayoutEditor({
  showPreview = true,
  wide = false,
}: {
  showPreview?: boolean;
  // Escritorio: la vista previa a la izquierda y los controles a la derecha.
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const {
    enabled,
    zones,
    focusedZoneId,
    setEnabled,
    addZone,
    applyPreset,
    activePreset,
    savedPresets,
    defaultPreset,
    resetPreset,
    setDefaultPreset,
  } = useCallLayoutStore();
  const active = LAYOUT_PRESETS.find((preset) => preset.id === activePreset);
  const tree = useMemo(() => buildLayoutTree(zones), [zones]);
  const zoneIndex = new Map(zones.map((zone, index) => [zone.id, index]));

  const previewNode = tree && showPreview && (
    <div className={styles.preview} data-testid="layout-preview">
      <LayoutView
        tree={tree}
        zoneProps={(zone) => ({
          style: zoneColorStyle(zoneIndex.get(zone.id) ?? 0),
          focused: zone.id === focusedZoneId,
        })}
        renderZone={(zone) => (
          <span className={styles.previewZone}>
            {(zoneIndex.get(zone.id) ?? 0) + 1} · {zone.capacity} {t('pers.')}
          </span>
        )}
      />
    </div>
  );
  const top = (
    <>
      <div className={styles.editorHead}>
        <div className={styles.switchRow}>
          <span>{t('Usar mi distribución en las llamadas')}</span>
          <ToggleSwitch
            checked={enabled}
            onChange={setEnabled}
            aria-label={t('Usar mi distribución en las llamadas')}
          />
        </div>
        <p className={styles.editorHint}>
          {t(
            'Las personas van llenando la Zona 1, después la 2, y así. Las que no entran van a la última.',
          )}
        </p>
        <p className={styles.editorHint}>
          {t('Una zona sin nadie no ocupa lugar: con poca gente, las primeras se agrandan.')}
        </p>
      </div>
      <div className={styles.presets} role="group" aria-label={t('Distribuciones listas')}>
        {LAYOUT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={styles.preset}
            aria-pressed={preset.id === activePreset}
            onClick={() => applyPreset(preset.id)}
            title={t(preset.hint)}
          >
            {t(preset.label)}
            {preset.id === defaultPreset && (
              <span className={styles.presetStar} aria-label={t('predeterminado')}>
                ★
              </span>
            )}
          </button>
        ))}
      </div>
      {active && (
        <div className={styles.presetActions}>
          <button
            type="button"
            className={styles.presetAction}
            aria-pressed={defaultPreset === active.id}
            onClick={() => setDefaultPreset(defaultPreset === active.id ? null : active.id)}
          >
            {t(
              defaultPreset === active.id
                ? 'Se usa al entrar a una llamada'
                : 'Usar al entrar a una llamada',
            )}
          </button>
          {savedPresets[active.id] && (
            <button
              type="button"
              className={styles.presetAction}
              onClick={() => resetPreset(active.id)}
            >
              {t('Restablecer')} {t(active.label)}
            </button>
          )}
        </div>
      )}
    </>
  );
  const bottom = (
    <>
      {zones.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>{t('Todavía no hay zonas')}</strong>
          <span>{t('Agregá una zona para empezar a armar tu pantalla.')}</span>
        </div>
      ) : (
        <>
          <span className={styles.zoneCount}>
            {zones.length} {t(zones.length === 1 ? 'zona' : 'zonas')}
          </span>
          <div className={styles.zoneList}>
            {zones.map((zone, index) => (
              <ZoneCard key={zone.id} zone={zone} index={index} open={zone.id === focusedZoneId} />
            ))}
          </div>
        </>
      )}
      <button type="button" className={styles.addZone} onClick={addZone}>
        <span aria-hidden="true">+</span> {t('Agregar zona')}
      </button>
    </>
  );

  if (wide && previewNode) {
    return (
      <div className={styles.editorWide}>
        {previewNode}
        <div className={styles.editor}>
          {top}
          {bottom}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.editor}>
      {top}
      {previewNode}
      {bottom}
    </div>
  );
}
