import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LayoutZone } from './layout';
import { LAYOUT_PRESETS, type LayoutPresetId } from './presets';

type ZoneChanges = Partial<Omit<LayoutZone, 'id'>>;

interface CallLayoutState {
  enabled: boolean;
  zones: LayoutZone[];
  // True while the tiles editor is open; never persisted.
  editing: boolean;
  // Zone whose controls are open in the editor; never persisted.
  focusedZoneId: string | null;
  setEditing: (editing: boolean) => void;
  setFocusedZone: (id: string | null) => void;
  setEnabled: (enabled: boolean) => void;
  addZone: () => void;
  updateZone: (id: string, changes: ZoneChanges) => void;
  removeZone: (id: string) => void;
  // Preset en uso: los cambios de zonas se guardan en ese preset.
  activePreset: LayoutPresetId | null;
  savedPresets: Partial<Record<LayoutPresetId, LayoutZone[]>>;
  // Preset con el que arranca cada llamada.
  defaultPreset: LayoutPresetId | null;
  applyPreset: (id: LayoutPresetId) => void;
  resetPreset: (id: LayoutPresetId) => void;
  setDefaultPreset: (id: LayoutPresetId | null) => void;
  applyDefaultPreset: () => void;
}

type Persisted = Pick<
  CallLayoutState,
  'enabled' | 'zones' | 'activePreset' | 'savedPresets' | 'defaultPreset'
>;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value) || min));

function sanitize(zone: LayoutZone): LayoutZone {
  return {
    ...zone,
    capacity: clamp(zone.capacity, 1, 50),
    width: clamp(zone.width, 10, 100),
    height: clamp(zone.height, 10, 100),
    scale: clamp(zone.scale, 30, 100),
  };
}

const SIDE_BY_SIDE = new Set(['left', 'right', 'beside-previous']);

// A full-size zone docked sideways would leave nothing for its neighbour.
function sizeForPlacement(zone: LayoutZone, changes: ZoneChanges): ZoneChanges {
  if (!changes.placement || changes.placement === zone.placement) return {};
  return SIDE_BY_SIDE.has(changes.placement)
    ? { width: 30, height: 100 }
    : { width: 100, height: 30 };
}

let created = 0;
const newZoneId = () => `zone-${Date.now().toString(36)}-${(created++).toString(36)}`;

function factoryZones(id: LayoutPresetId): LayoutZone[] {
  const preset = LAYOUT_PRESETS.find((candidate) => candidate.id === id);
  return (preset?.zones ?? []).map((zone) => ({ ...zone, id: newZoneId() }));
}

// Cada cambio de zonas queda guardado también en el preset activo.
function withZones(
  state: Pick<CallLayoutState, 'activePreset' | 'savedPresets'>,
  zones: LayoutZone[],
): Pick<CallLayoutState, 'zones' | 'savedPresets'> {
  if (!state.activePreset) return { zones, savedPresets: state.savedPresets };
  return { zones, savedPresets: { ...state.savedPresets, [state.activePreset]: zones } };
}

function defaultZone(isFirst: boolean): LayoutZone {
  return isFirst
    ? {
        id: newZoneId(),
        capacity: 1,
        placement: 'bottom',
        width: 100,
        height: 100,
        scale: 100,
        aspect: '16:9',
      }
    : {
        id: newZoneId(),
        capacity: 4,
        placement: 'bottom',
        width: 100,
        height: 30,
        scale: 100,
        aspect: '16:9',
      };
}

export const useCallLayoutStore = create<CallLayoutState>()(
  persist(
    (set, get) => ({
      enabled: false,
      zones: [],
      activePreset: null,
      savedPresets: {},
      defaultPreset: null,
      editing: false,
      focusedZoneId: null,
      setEditing: (editing) => set({ editing }),
      setFocusedZone: (focusedZoneId) => set({ focusedZoneId }),
      setEnabled: (enabled) => set({ enabled }),
      addZone: () =>
        set((state) => {
          const zone = defaultZone(state.zones.length === 0);
          return { ...withZones(state, [...state.zones, zone]), focusedZoneId: zone.id };
        }),
      updateZone: (id, changes) =>
        set((state) =>
          withZones(
            state,
            state.zones.map((zone) =>
              zone.id === id
                ? sanitize({ ...zone, ...sizeForPlacement(zone, changes), ...changes })
                : zone,
            ),
          ),
        ),
      applyPreset: (id) =>
        set(({ savedPresets }) => ({
          enabled: true,
          activePreset: id,
          focusedZoneId: null,
          zones: savedPresets[id] ?? factoryZones(id),
        })),
      resetPreset: (id) =>
        set(({ savedPresets, activePreset }) => {
          const { [id]: _discarded, ...rest } = savedPresets;
          return activePreset === id
            ? { savedPresets: rest, zones: factoryZones(id), focusedZoneId: null }
            : { savedPresets: rest };
        }),
      setDefaultPreset: (defaultPreset) => set({ defaultPreset }),
      applyDefaultPreset: () => {
        const { defaultPreset, applyPreset } = get();
        if (defaultPreset) applyPreset(defaultPreset);
      },
      removeZone: (id) =>
        set((state) => ({
          ...withZones(
            state,
            state.zones.filter((zone) => zone.id !== id),
          ),
          focusedZoneId: state.focusedZoneId === id ? null : state.focusedZoneId,
        })),
    }),
    {
      name: 'date2gether:call-layout',
      version: 3,
      partialize: ({ enabled, zones, activePreset, savedPresets, defaultPreset }) => ({
        enabled,
        zones,
        activePreset,
        savedPresets,
        defaultPreset,
      }),
      // v1 stored a fixed tile width in px; tiles now fill their zone.
      migrate: (persisted, version) => {
        const saved = persisted as {
          enabled?: boolean;
          zones?: (LayoutZone & { tileSize?: number })[];
        };
        if (version < 2) {
          saved.zones = (saved.zones ?? []).map(({ tileSize: _old, ...zone }) => ({
            ...zone,
            scale: 100,
          }));
        }
        return { activePreset: null, savedPresets: {}, defaultPreset: null, ...saved } as Persisted;
      },
    },
  ),
);
