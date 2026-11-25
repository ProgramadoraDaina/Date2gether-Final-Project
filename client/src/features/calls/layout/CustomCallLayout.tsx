'use client';

import { useMemo } from 'react';
import { TrackRefContext, type TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { useTranslation } from '@/features/translation/useTranslation';
import { ReactionTile } from '../reactions/ReactionTile';
import { assignToZones, buildLayoutTree, zonesInUse, type LayoutZone } from './layout';
import { LayoutView } from './LayoutView';
import { ZoneTiles } from './ZoneTiles';
import { useCallLayoutStore } from './store';
import { zoneColorStyle } from './zoneColors';
import styles from './CallLayout.module.css';

interface CustomCallLayoutProps {
  tracks: TrackReferenceOrPlaceholder[];
  zones: LayoutZone[];
  // Outlines and numbers the zones while the tiles editor is open.
  editing?: boolean;
}

const trackKey = (track: TrackReferenceOrPlaceholder) =>
  `${track.participant.identity}-${track.source}`;

export function CustomCallLayout({ tracks, zones, editing = false }: CustomCallLayoutProps) {
  const { t } = useTranslation();
  const focusedZoneId = useCallLayoutStore((state) => state.focusedZoneId);
  // Con el editor abierto se ven todas las zonas; en la llamada, solo las que tienen gente.
  const shown = useMemo(
    () => (editing ? zones : zonesInUse(zones, tracks.length)),
    [editing, zones, tracks.length],
  );
  const tree = useMemo(() => buildLayoutTree(shown), [shown]);
  const groups = useMemo(() => {
    const ordered = [
      ...tracks.filter((track) => track.source === 'screen_share'),
      ...tracks.filter((track) => track.source !== 'screen_share'),
    ];
    const assigned = assignToZones(shown, ordered);
    return new Map(shown.map((zone, index) => [zone.id, assigned[index]]));
  }, [tracks, shown]);
  const zoneNumber = useMemo(
    () => new Map(zones.map((zone, index) => [zone.id, index + 1])),
    [zones],
  );

  if (!tree) return null;
  return (
    <div className={styles.stage} data-editing={editing} data-testid="layout-stage">
      <LayoutView
        tree={tree}
        zoneProps={(zone) => ({
          style: zoneColorStyle((zoneNumber.get(zone.id) ?? 1) - 1),
          focused: editing && zone.id === focusedZoneId,
        })}
        renderZone={(zone) => {
          const members = groups.get(zone.id) ?? [];
          return (
            <>
              {editing && (
                <span className={styles.zoneLabel}>
                  {`${t('Zona')} ${zoneNumber.get(zone.id)} · ${members.length}/${zone.capacity}`}
                </span>
              )}
              <ZoneTiles
                zone={zone}
                items={members.map((track) => ({
                  key: trackKey(track),
                  // A shared screen must stay whole; cameras are cropped to the tile shape.
                  fit: track.source === 'screen_share' ? 'contain' : 'cover',
                  content: (
                    <TrackRefContext.Provider value={track}>
                      <ReactionTile canFocus={tracks.length > 1} />
                    </TrackRefContext.Provider>
                  ),
                }))}
              />
            </>
          );
        }}
      />
    </div>
  );
}
