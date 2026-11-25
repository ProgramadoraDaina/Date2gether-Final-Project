import type { LayoutZone } from './layout';

export type LayoutPresetId = 'class' | 'talk' | 'hangout';

type PresetZone = Omit<LayoutZone, 'id'>;

export const LAYOUT_PRESETS: {
  id: LayoutPresetId;
  label: string;
  hint: string;
  zones: PresetZone[];
}[] = [
  {
    id: 'class',
    label: 'Clase',
    hint: 'Una persona grande y el resto en una fila abajo.',
    zones: [
      { capacity: 1, placement: 'bottom', width: 100, height: 100, scale: 100, aspect: '16:9' },
      { capacity: 12, placement: 'bottom', width: 100, height: 26, scale: 100, aspect: '16:9' },
    ],
  },
  {
    id: 'talk',
    label: 'Charla',
    hint: 'Dos personas lado a lado y el resto en una columna a la derecha.',
    zones: [
      { capacity: 2, placement: 'bottom', width: 100, height: 100, scale: 100, aspect: '4:3' },
      { capacity: 12, placement: 'right', width: 24, height: 100, scale: 100, aspect: '16:9' },
    ],
  },
  {
    id: 'hangout',
    label: 'Juntada',
    hint: 'Todos iguales, en una sola grilla.',
    zones: [
      { capacity: 50, placement: 'bottom', width: 100, height: 100, scale: 100, aspect: '1:1' },
    ],
  },
];
