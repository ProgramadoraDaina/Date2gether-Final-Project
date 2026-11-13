import { describe, expect, it } from '@jest/globals';
import { aggregateSession, type IdentityCorrelation, type SessionEvent } from './aggregate-session';

const t0 = new Date('2026-11-06T10:00:00Z');
const seconds = (n: number) => new Date(t0.getTime() + n * 1000);

describe('aggregateSession', () => {
  it('sesión con 3 participantes (incl. un invitado): una entrada por cada uno con join/leave/duración/spoke/screenShared (spec timeline/materialización)', () => {
    const identities: IdentityCorrelation[] = [
      { livekitIdentity: 'id-a', userId: 'user-a', displayName: 'Ana' },
      { livekitIdentity: 'id-b', userId: 'user-b', displayName: 'Beto' },
      { livekitIdentity: 'id-c', userId: null, displayName: 'Carla' },
    ];
    const events: SessionEvent[] = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: seconds(0),
      },
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-b',
        trackSource: null,
        occurredAt: seconds(5),
      },
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-c',
        trackSource: null,
        occurredAt: seconds(2),
      },
      {
        eventType: 'track_published',
        livekitIdentity: 'id-a',
        trackSource: 'microphone',
        occurredAt: seconds(10),
      },
      {
        eventType: 'track_published',
        livekitIdentity: 'id-b',
        trackSource: 'screen_share',
        occurredAt: seconds(20),
      },
      {
        eventType: 'track_unpublished',
        livekitIdentity: 'id-b',
        trackSource: 'screen_share',
        occurredAt: seconds(200),
      },
      {
        eventType: 'participant_left',
        livekitIdentity: 'id-c',
        trackSource: null,
        occurredAt: seconds(250),
      },
      {
        eventType: 'participant_left',
        livekitIdentity: 'id-b',
        trackSource: null,
        occurredAt: seconds(280),
      },
      {
        eventType: 'participant_left',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: seconds(300),
      },
    ];

    const summary = aggregateSession(events, identities, seconds(400));

    expect(summary).toHaveLength(3);

    const ana = summary.find((s) => s.participantKey === 'user-a');
    expect(ana).toMatchObject({
      userId: 'user-a',
      displayName: 'Ana',
      isGuest: false,
      firstJoinedAt: seconds(0),
      lastLeftAt: seconds(300),
      totalSeconds: 300,
      spoke: true,
      screenShared: false,
      rejoinCount: 0,
    });

    const beto = summary.find((s) => s.participantKey === 'user-b');
    expect(beto).toMatchObject({
      userId: 'user-b',
      displayName: 'Beto',
      isGuest: false,
      firstJoinedAt: seconds(5),
      lastLeftAt: seconds(280),
      totalSeconds: 275,
      spoke: false,
      screenShared: true,
      rejoinCount: 0,
    });

    const carla = summary.find((s) => s.participantKey === 'guest:carla');
    expect(carla).toMatchObject({
      userId: null,
      displayName: 'Carla',
      isGuest: true,
      firstJoinedAt: seconds(2),
      lastLeftAt: seconds(250),
      totalSeconds: 248,
      spoke: false,
      screenShared: false,
      rejoinCount: 0,
    });
  });

  it('mismo invitado se reconecta (dos pares join/leave con identities distintas): una sola entrada con duración sumada y rejoinCount (spec timeline/reconexiones)', () => {
    const identities: IdentityCorrelation[] = [
      { livekitIdentity: 'id-c1', userId: null, displayName: 'Carla' },
      { livekitIdentity: 'id-c2', userId: null, displayName: 'Carla' },
    ];
    const events: SessionEvent[] = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-c1',
        trackSource: null,
        occurredAt: seconds(0),
      },
      {
        eventType: 'participant_left',
        livekitIdentity: 'id-c1',
        trackSource: null,
        occurredAt: seconds(50),
      },
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-c2',
        trackSource: null,
        occurredAt: seconds(60),
      },
      {
        eventType: 'participant_left',
        livekitIdentity: 'id-c2',
        trackSource: null,
        occurredAt: seconds(150),
      },
    ];

    const summary = aggregateSession(events, identities, seconds(400));

    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      participantKey: 'guest:carla',
      firstJoinedAt: seconds(0),
      lastLeftAt: seconds(150),
      totalSeconds: 50 + 90,
      rejoinCount: 1,
    });
  });

  it('misma cuenta registrada con dos pares join/leave: una sola entrada, no dos (spec timeline/reconexiones)', () => {
    const identities: IdentityCorrelation[] = [
      { livekitIdentity: 'id-a1', userId: 'user-a', displayName: 'Ana' },
      { livekitIdentity: 'id-a2', userId: 'user-a', displayName: 'Ana' },
    ];
    const events: SessionEvent[] = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a1',
        trackSource: null,
        occurredAt: seconds(0),
      },
      {
        eventType: 'participant_left',
        livekitIdentity: 'id-a1',
        trackSource: null,
        occurredAt: seconds(30),
      },
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a2',
        trackSource: null,
        occurredAt: seconds(40),
      },
      {
        eventType: 'participant_left',
        livekitIdentity: 'id-a2',
        trackSource: null,
        occurredAt: seconds(100),
      },
    ];

    const summary = aggregateSession(events, identities, seconds(400));

    expect(summary).toHaveLength(1);
    expect(summary[0].participantKey).toBe('user-a');
    expect(summary[0].rejoinCount).toBe(1);
  });

  it('track publicado sin evento de cierre explícito y sin participant_left (navegador colgado): spoke/screenShared true y cierre implícito con fallbackEndAt (spec timeline/cierre-implícito)', () => {
    const identities: IdentityCorrelation[] = [
      { livekitIdentity: 'id-a', userId: 'user-a', displayName: 'Ana' },
    ];
    const events: SessionEvent[] = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: seconds(0),
      },
      {
        eventType: 'track_published',
        livekitIdentity: 'id-a',
        trackSource: 'microphone',
        occurredAt: seconds(10),
      },
      // Nunca llega track_unpublished ni participant_left: navegador colgado.
    ];
    const fallbackEndAt = seconds(400);

    const summary = aggregateSession(events, identities, fallbackEndAt);

    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      participantKey: 'user-a',
      spoke: true,
      screenShared: false,
      firstJoinedAt: seconds(0),
      lastLeftAt: fallbackEndAt,
      totalSeconds: 400,
      rejoinCount: 0,
    });
  });

  it('registra varios intervalos reales de cámara con sus horas exactas (prender/apagar/prender)', () => {
    const identities: IdentityCorrelation[] = [
      { livekitIdentity: 'id-a', userId: 'user-a', displayName: 'Ana' },
    ];
    const events: SessionEvent[] = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: seconds(0),
      },
      {
        eventType: 'track_published',
        livekitIdentity: 'id-a',
        trackSource: 'camera',
        occurredAt: seconds(10),
      },
      {
        eventType: 'track_unpublished',
        livekitIdentity: 'id-a',
        trackSource: 'camera',
        occurredAt: seconds(60),
      },
      {
        eventType: 'track_published',
        livekitIdentity: 'id-a',
        trackSource: 'camera',
        occurredAt: seconds(90),
      },
      {
        eventType: 'track_unpublished',
        livekitIdentity: 'id-a',
        trackSource: 'camera',
        occurredAt: seconds(150),
      },
      {
        eventType: 'participant_left',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: seconds(200),
      },
    ];

    const summary = aggregateSession(events, identities, seconds(400));

    expect(summary).toHaveLength(1);
    expect(summary[0].trackIntervals).toEqual([
      { source: 'camera', startedAt: seconds(10), endedAt: seconds(60) },
      { source: 'camera', startedAt: seconds(90), endedAt: seconds(150) },
    ]);
  });

  it('mutear y volver a desmutear el micrófono después de la primera publicación cierra y abre un segundo intervalo (no uno solo sin fin)', () => {
    const identities: IdentityCorrelation[] = [
      { livekitIdentity: 'id-a', userId: 'user-a', displayName: 'Ana' },
    ];
    const events: SessionEvent[] = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: seconds(0),
      },
      // Primera vez: LiveKit sí manda track_published.
      {
        eventType: 'track_published',
        livekitIdentity: 'id-a',
        trackSource: 'microphone',
        occurredAt: seconds(5),
      },
      // De acá en más, mutear/desmutear nunca vuelve a publicar/despublicar
      // (ver CallsService.reportTrackState): el propio cliente reporta
      // track_muted/track_unmuted.
      {
        eventType: 'track_muted',
        livekitIdentity: 'id-a',
        trackSource: 'microphone',
        occurredAt: seconds(20),
      },
      {
        eventType: 'track_unmuted',
        livekitIdentity: 'id-a',
        trackSource: 'microphone',
        occurredAt: seconds(50),
      },
      // El navegador se cierra sin mandar un último track_muted: el segundo
      // intervalo se cierra por el mismo cierre implícito que el join
      // (fallbackEndAt), no se queda abierto para siempre.
      {
        eventType: 'participant_left',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: seconds(100),
      },
    ];
    const fallbackEndAt = seconds(400);

    const summary = aggregateSession(events, identities, fallbackEndAt);

    expect(summary[0].trackIntervals).toEqual([
      { source: 'microphone', startedAt: seconds(5), endedAt: seconds(20) },
      { source: 'microphone', startedAt: seconds(50), endedAt: fallbackEndAt },
    ]);
    expect(summary[0].spoke).toBe(true);
  });

  it('cámara y micrófono abiertos a la vez generan intervalos independientes, cada uno con su propio cierre', () => {
    const identities: IdentityCorrelation[] = [
      { livekitIdentity: 'id-a', userId: 'user-a', displayName: 'Ana' },
    ];
    const events: SessionEvent[] = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: seconds(0),
      },
      {
        eventType: 'track_published',
        livekitIdentity: 'id-a',
        trackSource: 'camera',
        occurredAt: seconds(5),
      },
      {
        eventType: 'track_published',
        livekitIdentity: 'id-a',
        trackSource: 'microphone',
        occurredAt: seconds(8),
      },
      {
        eventType: 'track_unpublished',
        livekitIdentity: 'id-a',
        trackSource: 'microphone',
        occurredAt: seconds(40),
      },
      {
        eventType: 'track_unpublished',
        livekitIdentity: 'id-a',
        trackSource: 'camera',
        occurredAt: seconds(100),
      },
      {
        eventType: 'participant_left',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: seconds(150),
      },
    ];

    const summary = aggregateSession(events, identities, seconds(400));

    expect(summary[0].trackIntervals).toEqual([
      { source: 'camera', startedAt: seconds(5), endedAt: seconds(100) },
      { source: 'microphone', startedAt: seconds(8), endedAt: seconds(40) },
    ]);
    expect(summary[0].spoke).toBe(true);
  });

  it('cámara que queda prendida sin unpublish (navegador colgado) cierra con fallbackEndAt, igual que join', () => {
    const identities: IdentityCorrelation[] = [
      { livekitIdentity: 'id-a', userId: 'user-a', displayName: 'Ana' },
    ];
    const events: SessionEvent[] = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: seconds(0),
      },
      {
        eventType: 'track_published',
        livekitIdentity: 'id-a',
        trackSource: 'camera',
        occurredAt: seconds(10),
      },
    ];
    const fallbackEndAt = seconds(400);

    const summary = aggregateSession(events, identities, fallbackEndAt);

    expect(summary[0].trackIntervals).toEqual([
      { source: 'camera', startedAt: seconds(10), endedAt: fallbackEndAt },
    ]);
  });

  it('sesión sin eventos devuelve un resumen vacío', () => {
    expect(aggregateSession([], [], seconds(0))).toEqual([]);
  });

  it('ignora eventos de identity sin correlación conocida (defensivo) en lugar de tirar', () => {
    const events: SessionEvent[] = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-huerfano',
        trackSource: null,
        occurredAt: seconds(0),
      },
    ];
    expect(() => aggregateSession(events, [], seconds(100))).not.toThrow();
    expect(aggregateSession(events, [], seconds(100))).toEqual([]);
  });
});
