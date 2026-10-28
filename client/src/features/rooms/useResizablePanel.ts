'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

interface UseResizablePanelOptions {
  // Clave de localStorage para recordar el ancho elegido entre sesiones.
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  // A qué borde de la pantalla está anclado el panel: determina si arrastrar
  // hacia la derecha agranda o achica (sidebar izquierda = 'left', panel de
  // chat anclado a la derecha = 'right').
  edge: 'left' | 'right';
}

interface UseResizablePanelResult {
  width: number;
  // Handler para el onMouseDown del handle de arrastre.
  handleMouseDown: (e: ReactMouseEvent) => void;
}

export function useResizablePanel({
  storageKey,
  defaultWidth,
  min,
  max,
  edge,
}: UseResizablePanelOptions): UseResizablePanelResult {
  const [width, setWidth] = useState(defaultWidth);
  // "Ref espejo" del último `width`: hace falta leerlo de forma síncrona
  // dentro de los listeners nativos de mousemove/mouseup (que no deberían
  // depender del `width` capturado por closure en el momento del
  // mousedown). Se sincroniza en un efecto, no mutando el ref durante el
  // render (React no garantiza pureza ahí).
  const widthRef = useRef(defaultWidth);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  // Listeners activos del drag en curso (si hay uno). Permite limpiarlos si
  // el componente se desmonta a mitad de un arrastre, no solo en mouseup.
  const activeDragRef = useRef<{ onMouseMove: (e: MouseEvent) => void; onMouseUp: () => void } | null>(
    null,
  );
  useEffect(() => {
    return () => {
      if (!activeDragRef.current) return;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', activeDragRef.current.onMouseMove);
      window.removeEventListener('mouseup', activeDragRef.current.onMouseUp);
      activeDragRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stored = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored >= min && stored <= max) {
      setWidth(stored);
    }
  }, [storageKey, min, max]);

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widthRef.current;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMouseMove(ev: MouseEvent) {
        const delta = ev.clientX - startX;
        const signedDelta = edge === 'left' ? delta : -delta;
        setWidth(Math.min(max, Math.max(min, startWidth + signedDelta)));
      }

      function onMouseUp() {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(storageKey, String(widthRef.current));
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        activeDragRef.current = null;
      }

      activeDragRef.current = { onMouseMove, onMouseUp };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [edge, max, min, storageKey],
  );

  return { width, handleMouseDown };
}
