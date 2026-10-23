import type { RoomRole } from '@/lib/api';

const ROLE_LABELS: Record<RoomRole, { short: string; full: string }> = {
  administrador: { short: 'admin', full: 'Administrador' },
  colaborador: { short: 'colab', full: 'Colaborador' },
  participante: { short: 'part', full: 'Participante' },
};

interface RoleTagProps {
  role: RoomRole;
}

export function RoleTag({ role }: RoleTagProps) {
  const { short, full } = ROLE_LABELS[role];
  return (
    <abbr title={full} className={`role-tag role-tag-${role}`}>
      {short}
    </abbr>
  );
}
