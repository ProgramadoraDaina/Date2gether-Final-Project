import { beforeEach, describe, expect, it } from '@jest/globals';
import { act } from '@testing-library/react';
import { useCallLayoutStore } from './store';

const state = () => useCallLayoutStore.getState();

describe('useCallLayoutStore', () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => useCallLayoutStore.setState({ enabled: false, zones: [] }));
  });

  it('agregar zonas: la primera es la grande, las siguientes van abajo', () => {
    act(() => {
      state().addZone();
      state().addZone();
    });
    const [first, second] = state().zones;
    expect(first).toMatchObject({ capacity: 1, width: 100, height: 100, scale: 100 });
    expect(second).toMatchObject({ placement: 'bottom', capacity: 4, scale: 100 });
    expect(first.id).not.toBe(second.id);
  });

  it('actualiza una zona y limita los valores a rangos válidos', () => {
    act(() => state().addZone());
    const { id } = state().zones[0];
    act(() => state().updateZone(id, { width: 250, height: 0, capacity: -3, scale: 5000 }));
    expect(state().zones[0]).toMatchObject({ width: 100, height: 10, capacity: 1, scale: 100 });
    act(() => state().updateZone(id, { scale: 5 }));
    expect(state().zones[0].scale).toBe(30);
  });

  it('una distribución guardada con el tamaño viejo en px pasa a llenar la zona', async () => {
    localStorage.setItem(
      'date2gether:call-layout',
      JSON.stringify({
        version: 1,
        state: {
          enabled: true,
          zones: [
            {
              id: 'z1',
              capacity: 1,
              placement: 'bottom',
              width: 100,
              height: 100,
              tileSize: 480,
              aspect: '16:9',
            },
          ],
        },
      }),
    );
    await act(() => useCallLayoutStore.persist.rehydrate());
    expect(state().zones[0]).toMatchObject({ id: 'z1', scale: 100 });
    expect(state().zones[0]).not.toHaveProperty('tileSize');
    expect(state().enabled).toBe(true);
  });

  it('al cambiar la posición, la zona deja lugar a la de al lado', () => {
    act(() => {
      state().addZone();
      state().addZone();
    });
    const { id } = state().zones[1];
    act(() => state().updateZone(id, { placement: 'right' }));
    expect(state().zones[1]).toMatchObject({ placement: 'right', width: 30, height: 100 });
    act(() => state().updateZone(id, { placement: 'below-previous' }));
    expect(state().zones[1]).toMatchObject({ width: 100, height: 30 });
    act(() => state().updateZone(id, { width: 55 }));
    expect(state().zones[1]).toMatchObject({ placement: 'below-previous', width: 55 });
  });

  it('quita una zona y persiste en este navegador', () => {
    act(() => {
      state().addZone();
      state().addZone();
      state().setEnabled(true);
    });
    act(() => state().removeZone(state().zones[0].id));
    expect(state().zones).toHaveLength(1);
    const saved = JSON.parse(localStorage.getItem('date2gether:call-layout') ?? '{}');
    expect(saved.state).toMatchObject({ enabled: true, zones: [{ placement: 'bottom' }] });
  });
});

describe('applyPreset', () => {
  it('reemplaza las zonas por las del preset y activa la distribución', () => {
    useCallLayoutStore.setState({ enabled: false, zones: [], focusedZoneId: null });
    useCallLayoutStore.getState().applyPreset('class');
    const { enabled, zones } = useCallLayoutStore.getState();
    expect(enabled).toBe(true);
    expect(zones.map((zone) => zone.capacity)).toEqual([1, 12]);
    expect(new Set(zones.map((zone) => zone.id)).size).toBe(2);
  });
});
