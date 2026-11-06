import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { CallSessionParticipantSummary } from '@/lib/api';

jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, language: 'es' }) };
});

function participant(
  overrides: Partial<CallSessionParticipantSummary> = {},
): CallSessionParticipantSummary {
  return {
    participantKey: 'user-1',
    userId: 'user-1',
    displayName: 'Daina Gacha',
    isGuest: false,
    firstJoinedAt: '2026-01-05T10:00:00.000Z',
    lastLeftAt: '2026-01-05T10:30:00.000Z',
    totalSeconds: 1800,
    spoke: false,
    screenShared: false,
    rejoinCount: 0,
    nameColor: 'pink',
    ...overrides,
  };
}

describe('ParticipationTimeline', () => {
  it('muestra el mensaje vacío cuando no hay participantes', async () => {
    const { ParticipationTimeline } = await import('./ParticipationTimeline');
    render(<ParticipationTimeline participants={[]} />);
    expect(
      screen.getByText('Esta sesión no tiene participantes registrados.'),
    ).toBeInTheDocument();
  });

  it('muestra una entrada por participante, con su nombre y duración', async () => {
    const { ParticipationTimeline } = await import('./ParticipationTimeline');
    render(
      <ParticipationTimeline
        participants={[
          participant({ displayName: 'Daina Gacha', totalSeconds: 125 }),
          participant({
            participantKey: 'guest:alex',
            userId: null,
            displayName: 'Alex',
            isGuest: true,
            totalSeconds: 60,
          }),
        ]}
      />,
    );
    expect(screen.getByText('Daina Gacha')).toBeInTheDocument();
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getAllByTestId('initials-avatar')).toHaveLength(2);
  });

  it('marca a los invitados con una etiqueta diferenciada', async () => {
    const { ParticipationTimeline } = await import('./ParticipationTimeline');
    render(
      <ParticipationTimeline
        participants={[
          participant({
            participantKey: 'guest:alex',
            userId: null,
            displayName: 'Alex',
            isGuest: true,
          }),
        ]}
      />,
    );
    expect(screen.getByText('Invitado')).toBeInTheDocument();
  });

  it('muestra el chip "Habló" solo cuando el participante abrió el micrófono', async () => {
    const { ParticipationTimeline } = await import('./ParticipationTimeline');
    render(
      <ParticipationTimeline
        participants={[
          participant({ participantKey: 'user-1', spoke: true }),
          participant({ participantKey: 'user-2', spoke: false }),
        ]}
      />,
    );
    expect(screen.getAllByText('Habló')).toHaveLength(1);
  });

  it('muestra el chip "Compartió pantalla" solo cuando corresponde', async () => {
    const { ParticipationTimeline } = await import('./ParticipationTimeline');
    render(
      <ParticipationTimeline
        participants={[
          participant({ participantKey: 'user-1', screenShared: true }),
          participant({ participantKey: 'user-2', screenShared: false }),
        ]}
      />,
    );
    expect(screen.getAllByText('Compartió pantalla')).toHaveLength(1);
  });

  it('no muestra ningún chip cuando el participante ni habló ni compartió pantalla', async () => {
    const { ParticipationTimeline } = await import('./ParticipationTimeline');
    render(<ParticipationTimeline participants={[participant()]} />);
    expect(screen.queryByText('Habló')).not.toBeInTheDocument();
    expect(screen.queryByText('Compartió pantalla')).not.toBeInTheDocument();
  });
});
