import { beforeEach, describe, expect, it } from '@jest/globals';
import { backgroundOptions, BACKGROUND_PRESETS, presetCss } from './backgrounds';
import { useCallSettingsStore } from './store';

describe('fondos de la cámara', () => {
  beforeEach(() => {
    localStorage.clear();
    useCallSettingsStore.setState({ backgroundBlur: false, backgroundImage: null });
  });

  it('sin desenfoque ni imagen, el procesador queda apagado', () => {
    expect(backgroundOptions(false, null, () => '')).toEqual({ mode: 'disabled' });
  });

  it('el desenfoque usa el radio de siempre', () => {
    expect(backgroundOptions(true, null, () => '')).toEqual({
      mode: 'background-blur',
      blurRadius: 12,
    });
  });

  it('un fondo predefinido se resuelve a su imagen; uno subido se usa tal cual', () => {
    const render = (id: string) => `data:image/png;base64,${id}`;
    expect(backgroundOptions(false, 'preset:graphite', render)).toEqual({
      mode: 'virtual-background',
      imagePath: 'data:image/png;base64,graphite',
    });
    expect(backgroundOptions(false, 'data:image/jpeg;base64,abc', render)).toEqual({
      mode: 'virtual-background',
      imagePath: 'data:image/jpeg;base64,abc',
    });
  });

  it('un predefinido que ya no existe deja la cámara sin efecto', () => {
    expect(backgroundOptions(false, 'preset:no-existe', () => '')).toEqual({ mode: 'disabled' });
  });

  it('elegir una imagen apaga el desenfoque, y prender el desenfoque quita la imagen', () => {
    const store = useCallSettingsStore.getState();
    store.setPreference('backgroundBlur', true);
    useCallSettingsStore.getState().setBackgroundImage('preset:graphite');
    expect(useCallSettingsStore.getState()).toMatchObject({
      backgroundBlur: false,
      backgroundImage: 'preset:graphite',
    });

    useCallSettingsStore.getState().setPreference('backgroundBlur', true);
    expect(useCallSettingsStore.getState()).toMatchObject({
      backgroundBlur: true,
      backgroundImage: null,
    });
  });

  it('cada predefinido tiene una vista previa en CSS', () => {
    expect(BACKGROUND_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const preset of BACKGROUND_PRESETS) expect(presetCss(preset)).toContain('gradient');
  });
});
