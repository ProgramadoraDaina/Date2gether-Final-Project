export interface BackgroundPreset {
  id: string;
  label: string;
  from: string;
  to: string;
  glow: string;
}

// Drawn in the browser, so the app ships no third-party images.
export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: 'graphite', label: 'Grafito', from: '#1d2126', to: '#3a4048', glow: '#5b6470' },
  { id: 'sand', label: 'Arena', from: '#c9b79c', to: '#efe3cf', glow: '#fff6e6' },
  { id: 'forest', label: 'Bosque', from: '#1f3a2e', to: '#4f7a5f', glow: '#8fb89a' },
  { id: 'sunset', label: 'Atardecer', from: '#7a2e1f', to: '#f0821e', glow: '#ffd089' },
  { id: 'ocean', label: 'Océano', from: '#0f2a44', to: '#2f6f8f', glow: '#7fc4d8' },
];

export const PRESET_PREFIX = 'preset:';

export function presetCss(preset: BackgroundPreset): string {
  return `radial-gradient(circle at 70% 30%, ${preset.glow}66, transparent 45%), linear-gradient(135deg, ${preset.from}, ${preset.to})`;
}

const rendered = new Map<string, string>();

export function renderPreset(id: string): string {
  const preset = BACKGROUND_PRESETS.find((item) => item.id === id);
  if (!preset) return '';
  const cached = rendered.get(id);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const base = ctx.createLinearGradient(0, 0, 1280, 720);
  base.addColorStop(0, preset.from);
  base.addColorStop(1, preset.to);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1280, 720);
  for (const [x, y, r, alpha] of [
    [900, 220, 380, 0.45],
    [260, 560, 260, 0.25],
    [1150, 640, 200, 0.2],
  ]) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, `${preset.glow}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`);
    glow.addColorStop(1, `${preset.glow}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1280, 720);
  }
  const url = canvas.toDataURL('image/png');
  rendered.set(id, url);
  return url;
}

export type BackgroundOptions =
  | { mode: 'disabled' }
  | { mode: 'background-blur'; blurRadius: number }
  | { mode: 'virtual-background'; imagePath: string };

export function backgroundOptions(
  blur: boolean,
  image: string | null,
  render: (presetId: string) => string = renderPreset,
): BackgroundOptions {
  if (!image) return blur ? { mode: 'background-blur', blurRadius: 12 } : { mode: 'disabled' };
  if (!image.startsWith(PRESET_PREFIX)) return { mode: 'virtual-background', imagePath: image };
  const id = image.slice(PRESET_PREFIX.length);
  const imagePath = BACKGROUND_PRESETS.some((preset) => preset.id === id) ? render(id) : '';
  return imagePath ? { mode: 'virtual-background', imagePath } : { mode: 'disabled' };
}

const MAX_UPLOAD_WIDTH = 960;

// Downscaled JPEG keeps the stored image small enough for localStorage.
export function resizeImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        const scale = Math.min(1, MAX_UPLOAD_WIDTH / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas'));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
