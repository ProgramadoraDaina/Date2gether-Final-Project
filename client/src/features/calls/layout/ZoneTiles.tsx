'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fitTiles, type LayoutZone } from './layout';
import styles from './CallLayout.module.css';

interface ZoneTilesProps {
  zone: LayoutZone;
  items: { key: string; fit: 'cover' | 'contain'; content: ReactNode }[];
}

export function ZoneTiles({ zone, items }: ZoneTilesProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = fitTiles(size, items.length, zone.aspect, zone.scale);
  return (
    <div ref={ref} className={styles.zoneFill}>
      {items.map(({ key, fit: videoFit, content }) => (
        <div
          key={key}
          className={styles.tile}
          style={{ width: fit?.width, aspectRatio: zone.aspect.replace(':', ' / ') }}
          data-fit={videoFit}
          data-testid="layout-tile"
        >
          {content}
        </div>
      ))}
    </div>
  );
}
