import type { Page } from '@playwright/test';

// While a call attempt exists (connecting, in call or failed, as in CI without LiveKit)
// the room offers "Colgar" with confirmation instead of the sidebar "Salir" link.
export async function leaveRoom(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Colgar', exact: true }).click();
  await page.getByRole('button', { name: 'Salir de la llamada', exact: true }).click();
}
