import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LayoutZone } from './layout';

type ZoneChanges = Partial<Omit<LayoutZone, 'id'>>;

interface CallLayoutState {
  enabled: boolean;
  zones: LayoutZone[];
  // True while the tiles editor is open; never persisted.
  editing: boolean;
  setEditing: (editing: boolean) => void;
  setEnabled: (enabled: boolean) => void;
  addZone: () => void;
  updateZone: (id: string, changes: ZoneChanges) => void;
  removeZone: (id: string) => void;
}

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
    (set) => ({
      enabled: false,
      zones: [],
      editing: false,
      setEditing: (editing) => set({ editing }),
      setEnabled: (enabled) => set({ enabled }),
      addZone: () => set(({ zones }) => ({ zones: [...zones, defaultZone(zones.length === 0)] })),
      updateZone: (id, changes) =>
        set(({ zones }) => ({
          zones: zones.map((zone) =>
            zone.id === id
              ? sanitize({ ...zone, ...sizeForPlacement(zone, changes), ...changes })
              : zone,
          ),
        })),
      removeZone: (id) => set(({ zones }) => ({ zones: zones.filter((zone) => zone.id !== id) })),
    }),
    {
      name: 'date2gether:call-layout',
      version: 2,
      partialize: ({ enabled, zones }) => ({ enabled, zones }),
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
        return saved as Pick<CallLayoutState, 'enabled' | 'zones'>;
      },
    },
  ),
);
