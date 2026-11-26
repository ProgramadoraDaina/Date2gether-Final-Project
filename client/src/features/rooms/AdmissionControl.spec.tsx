import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AdmissionManagement } from '@/lib/api';

jest.mock('../translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  getRoomAdmission: jest.fn(),
  updateRoomAdmission: jest.fn(),
  decideAdmission: jest.fn(),
}));

function baseAdmission(overrides: Partial<AdmissionManagement> = {}): AdmissionManagement {
  return {
    waitingRoomEnabled: false,
    entryLocked: false,
    isPermanent: false,
    requests: [],
    ...overrides,
  };
}

const ADMISSION_HELP =
  'Aceptá o rechazá a quienes piden entrar y elegí cómo se ingresa a la sala. Las solicitudes se actualizan solas.';

async function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: /Administrar ingresos/ }));
  // Espera a que la carga inicial resuelva -- la leyenda del fieldset solo
  // se renderiza una vez que `data` llegó, a diferencia del heading del
  // diálogo, que está siempre presente.
  await screen.findByText('Configuración de ingreso');
}

describe('AdmissionControl', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('[5.8] una sala permanente oculta el toggle de sala de espera por completo', async () => {
    const { getRoomAdmission } = await import('@/lib/api');
    jest
      .mocked(getRoomAdmission)
      .mockResolvedValue(baseAdmission({ isPermanent: true, waitingRoomEnabled: true }));
    const { AdmissionControl } = await import('./AdmissionControl');

    render(<AdmissionControl code="abc-defg-hij" />);
    await openDialog();

    expect(screen.queryByLabelText('Activar sala de espera')).not.toBeInTheDocument();
    expect(
      screen.getByText('Esta sala es permanente: la sala de espera está siempre activa.'),
    ).toBeInTheDocument();
  });

  it('explica qué hace el botón y no ofrece actualizar a mano (se actualiza solo)', async () => {
    const { getRoomAdmission } = await import('@/lib/api');
    jest.mocked(getRoomAdmission).mockResolvedValue(baseAdmission());
    const { AdmissionControl } = await import('./AdmissionControl');

    render(<AdmissionControl code="abc-defg-hij" />);
    const trigger = screen.getByRole('button', { name: /Administrar ingresos/ });
    expect(trigger).toHaveAttribute('title', ADMISSION_HELP);
    await openDialog();

    expect(screen.getByText(ADMISSION_HELP)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Actualizar solicitudes' }),
    ).not.toBeInTheDocument();
  });

  it('una sala no permanente muestra el toggle de sala de espera', async () => {
    const { getRoomAdmission } = await import('@/lib/api');
    jest.mocked(getRoomAdmission).mockResolvedValue(baseAdmission());
    const { AdmissionControl } = await import('./AdmissionControl');

    render(<AdmissionControl code="abc-defg-hij" />);
    await openDialog();

    expect(screen.getByLabelText('Activar sala de espera')).toBeInTheDocument();
  });

  it('cada opción lleva su explicación asociada y las secciones son títulos', async () => {
    const { getRoomAdmission } = await import('@/lib/api');
    jest.mocked(getRoomAdmission).mockResolvedValue(baseAdmission());
    const { AdmissionControl } = await import('./AdmissionControl');

    render(<AdmissionControl code="abc-defg-hij" />);
    await openDialog();

    expect(screen.getByLabelText('Activar sala de espera')).toHaveAccessibleDescription(
      'Desactivar la espera admite las solicitudes pendientes cuando los ingresos están desbloqueados.',
    );
    expect(screen.getByLabelText('Bloquear nuevos ingresos')).toHaveAccessibleDescription(
      'Los cambios de ingreso no expulsan a quienes ya están dentro.',
    );
    expect(screen.getByRole('heading', { name: /Solicitudes pendientes/ })).toBeInTheDocument();
  });

  it('en una sala permanente no muestra la explicación de desactivar la espera', async () => {
    const { getRoomAdmission } = await import('@/lib/api');
    jest
      .mocked(getRoomAdmission)
      .mockResolvedValue(baseAdmission({ isPermanent: true, waitingRoomEnabled: true }));
    const { AdmissionControl } = await import('./AdmissionControl');

    render(<AdmissionControl code="abc-defg-hij" />);
    await openDialog();

    expect(
      screen.queryByText(
        'Desactivar la espera admite las solicitudes pendientes cuando los ingresos están desbloqueados.',
      ),
    ).not.toBeInTheDocument();
  });

  it('[5.8] marca una solicitud stale con una señal visible', async () => {
    const { getRoomAdmission } = await import('@/lib/api');
    jest.mocked(getRoomAdmission).mockResolvedValue(
      baseAdmission({
        isPermanent: true,
        waitingRoomEnabled: true,
        requests: [
          {
            id: 'req-old',
            name: 'Ana',
            registered: true,
            createdAt: '2026-01-01T00:00:00Z',
            stale: true,
          },
          {
            id: 'req-fresh',
            name: 'Bea',
            registered: false,
            createdAt: '2026-11-15T00:00:00Z',
            stale: false,
          },
        ],
      }),
    );
    const { AdmissionControl } = await import('./AdmissionControl');

    render(<AdmissionControl code="abc-defg-hij" />);
    await openDialog();

    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Esperando hace más de 24h');
    expect(items[1]).not.toHaveTextContent('Esperando hace más de 24h');
  });

  it('sin abrir el panel, avisa que alguien quiere entrar y deja admitirlo desde el aviso', async () => {
    const { getRoomAdmission, decideAdmission } = await import('@/lib/api');
    jest.mocked(getRoomAdmission).mockResolvedValue(
      baseAdmission({
        requests: [
          {
            id: 'req-1',
            name: 'Gabi',
            registered: false,
            createdAt: '2026-11-24T20:00:00Z',
            stale: false,
          },
        ],
      }),
    );
    jest.mocked(decideAdmission).mockResolvedValue(undefined as never);
    const { AdmissionControl } = await import('./AdmissionControl');

    render(<AdmissionControl code="abc-defg-hij" />);
    const toasts = await screen.findByRole('region', { name: 'Solicitudes para entrar' });
    expect(toasts).toHaveTextContent('Gabi quiere entrar a la sala');

    fireEvent.click(screen.getByRole('button', { name: 'Admitir Gabi' }));

    expect(decideAdmission).toHaveBeenCalledWith('abc-defg-hij', 'req-1', 'admitted');
  });
});
