'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { RoomMember, RoomRole } from '@/lib/api';
import { useDismiss } from '@/lib/useDismiss';
import { useTranslation } from '@/features/translation/useTranslation';
import styles from './MemberRoleMenu.module.css';

interface MemberRoleMenuProps {
  member: RoomMember;
  name: string;
  isLastAdmin: boolean;
  onChangeRole: (userId: string, role: RoomRole) => Promise<void>;
}

export function MemberRoleMenu({ member, name, isLastAdmin, onChangeRole }: MemberRoleMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const menuId = useId();
  const label = `${t('Permisos de')} ${name}`;
  useDismiss(open, containerRef, () => setOpen(false));

  useEffect(() => {
    if (open) {
      containerRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    } else if (!pending && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open, pending]);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open) {
      setOpen(true);
      return;
    }
    const items = Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }

  async function changeRole(role: RoomRole) {
    setPending(true);
    try {
      await onChangeRole(member.userId, role);
    } finally {
      restoreFocus.current = true;
      setPending(false);
      setOpen(false);
    }
  }

  return (
    <div
      className={styles.container}
      ref={containerRef}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid="role-button"
        disabled={pending}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">⋮</span>
      </button>
      {open && (
        <div id={menuId} className={styles.menu} role="menu" aria-label={label} aria-busy={pending}>
          <button
            type="button"
            role="menuitem"
            disabled={pending || isLastAdmin}
            title={isLastAdmin ? t('La sala debe conservar al menos un administrador') : undefined}
            onClick={() =>
              void changeRole(member.role === 'administrador' ? 'participante' : 'administrador')
            }
          >
            {t(member.role === 'administrador' ? 'Quitar administrador' : 'Hacer administrador')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={pending || isLastAdmin}
            title={isLastAdmin ? t('La sala debe conservar al menos un administrador') : undefined}
            onClick={() =>
              void changeRole(member.role === 'colaborador' ? 'participante' : 'colaborador')
            }
          >
            {t(member.role === 'colaborador' ? 'Quitar colaborador' : 'Hacer colaborador')}
          </button>
        </div>
      )}
    </div>
  );
}
