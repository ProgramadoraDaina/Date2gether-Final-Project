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
    expect(first).toMatchObject({ capacity: 1, width: 100, height: 100 });
    expect(second).toMatchObject({ placement: 'bottom', capacity: 4 });
    expect(first.id).not.toBe(second.id);
  });

  it('actualiza una zona y limita los valores a rangos válidos', () => {
    act(() => state().addZone());
    const { id } = state().zones[0];
    act(() => state().updateZone(id, { width: 250, height: 0, capacity: -3, tileSize: 5000 }));
    expect(state().zones[0]).toMatchObject({ width: 100, height: 10, capacity: 1, tileSize: 480 });
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
