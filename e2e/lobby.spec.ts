import { expect, test } from '@playwright/test';

// La captura usa dispositivos sintéticos de Chromium. No inicia LiveKit ni
// publica audio/video: comprueba el lobby real antes de solicitar acceso.
test.use({
  channel: 'chromium',
  permissions: ['camera', 'microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream'] },
});

test('el lobby permite probar y apagar dispositivos antes de conectar la reunión', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/\/rooms\/.*\/access|\/calls\/|socket\.io/.test(request.url()))
      requests.push(request.url());
  });
  await page.goto('/room/abc-defg-hij');
  await expect(page.getByRole('heading', { name: 'Entrar a la reunión' })).toBeVisible();
  await expect(page.getByText('Cámara apagada', { exact: true })).toBeVisible();
  const video = page.getByLabel('Vista previa de tu cámara');
  expect(await video.evaluate((element: HTMLVideoElement) => element.srcObject)).toBeNull();
  await page.getByRole('button', { name: 'Activar cámara', exact: true }).click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth))
    .toBeGreaterThan(0);
  await expect(page.getByLabel('Elegir cámara')).toHaveCount(1);
  await page.getByRole('button', { name: 'Activar micrófono', exact: true }).click();
  await expect(page.getByText('Hablá para comprobar el nivel del micrófono.')).toBeVisible();
  await expect
    .poll(() =>
      page.getByLabel('Nivel del micrófono').evaluate((element: HTMLMeterElement) => element.value),
    )
    .toBeGreaterThan(0);
  const tracksEnded = await video.evaluate((element: HTMLVideoElement) => {
    const stream = element.srcObject as MediaStream;
    (window as unknown as { previewTrack: MediaStreamTrack }).previewTrack =
      stream.getVideoTracks()[0];
    return stream.getVideoTracks()[0].readyState;
  });
  expect(tracksEnded).toBe('live');
  await page.getByRole('button', { name: 'Desactivar cámara', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { previewTrack: MediaStreamTrack }).previewTrack.readyState,
      ),
    )
    .toBe('ended');
  await page.getByRole('button', { name: 'Desactivar micrófono', exact: true }).click();
  await expect(page.getByText('Micrófono apagado', { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
});

test('el lobby mantiene sus controles dentro de una pantalla móvil', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/room/abc-defg-hij');
  await expect(page.getByLabel('Elegir cámara')).toBeVisible();
  await expect(page.getByLabel('Elegir micrófono')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
