export const HANDS_TOPIC = 'hands';

export interface RaisedHand {
  identity: string;
  name: string;
  at: number;
}

// raised=false con target: alguien con permisos baja la mano de otra persona.
export type HandMessage = { raised: true; at: number } | { raised: false; target?: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeHand(message: HandMessage): Uint8Array {
  return encoder.encode(JSON.stringify(message));
}

export function decodeHand(payload: Uint8Array): HandMessage | null {
  try {
    const value = JSON.parse(decoder.decode(payload)) as Record<string, unknown>;
    if (value.raised === true && typeof value.at === 'number')
      return { raised: true, at: value.at };
    if (value.raised === false)
      return typeof value.target === 'string'
        ? { raised: false, target: value.target }
        : { raised: false };
    return null;
  } catch {
    return null;
  }
}

// Bajarle la mano a otra persona es cosa de admins; cualquiera puede bajar la propia.
export function canLowerHandOf(sender: string, admins: readonly string[]): boolean {
  return admins.includes(sender);
}

// Turno por orden de llegada; a igual hora desempata la identity para que todos vean la misma fila.
export function handQueue(hands: Record<string, RaisedHand>): RaisedHand[] {
  return Object.values(hands).sort((a, b) => a.at - b.at || a.identity.localeCompare(b.identity));
}
