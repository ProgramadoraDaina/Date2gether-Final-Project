import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getRoomPreview } from '@/features/share/roomPreview';
import { shareMetadata } from '@/features/share/pageShare';

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const room = await getRoomPreview(code);
  const title = room ? `Te invitaron a «${room.name}»` : 'Te invitaron a una llamada';
  const description = room?.isPermanent
    ? `Sala permanente ${code}: el mismo link sirve para cada encuentro. Entrá desde el navegador, sin instalar nada.`
    : `Sala ${code}. Entrá desde el navegador, sin instalar nada ni crear una cuenta.`;
  return shareMetadata(title, description);
}

export default function RoomLayout({ children }: { children: ReactNode }) {
  return children;
}
