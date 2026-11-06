import { useCallback, useEffect, useRef, useState } from 'react';
import { getRoomNotes, RoomNotesConflictError, saveRoomNotes, type RoomNotes } from '@/lib/api';

type Status =
  'loading' | 'ready' | 'pending' | 'saving' | 'saved' | 'load-error' | 'save-error' | 'conflict';
interface NotesState {
  content: string;
  status: Status;
  remote: RoomNotes | null;
}
interface Draft {
  content: string;
  revision: number;
}
interface Actions {
  edit(content: string): void;
  retry(): void;
  resolveConflict(keepLocal: boolean): void;
}

function readDraft(key: string): Draft | null {
  try {
    const draft: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (
      draft &&
      typeof draft === 'object' &&
      'content' in draft &&
      'revision' in draft &&
      typeof draft.content === 'string' &&
      Number.isInteger(draft.revision) &&
      typeof draft.revision === 'number' &&
      draft.revision >= 0
    ) {
      return { content: draft.content, revision: draft.revision };
    }
  } catch {
    // El almacenamiento puede estar deshabilitado o contener un borrador inválido.
  }
  return null;
}

// La persistencia pertenece a la sesión de sala, independientemente de la
// pestaña visible. El borrador local permite recuperar también un cierre sin red.
export function useRoomNotes(code: string, token?: string, storageKey?: string) {
  const [state, setState] = useState<NotesState>({ content: '', status: 'loading', remote: null });
  const actions = useRef<Actions | null>(null);

  useEffect(() => {
    if (!token || !storageKey) return;
    let active = true;
    let leaving = false;
    let content = readDraft(storageKey)?.content ?? '';
    let savedContent = '';
    let revision: number | null = null;
    let status: Status = 'loading';
    let remote: RoomNotes | null = null;
    let saving = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dirty = () => revision !== null && content !== savedContent;
    const publish = () => {
      if (active) setState({ content, status, remote });
    };
    const persist = () => {
      if (revision === null) return;
      try {
        if (!dirty() && !saving) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, JSON.stringify({ content, revision }));
      } catch {
        // Los errores de red siguen mostrándose y el borrador permanece en memoria.
      }
    };
    function schedule() {
      clearTimeout(timer);
      if (dirty() && !saving && status !== 'conflict') {
        timer = setTimeout(() => {
          void flush();
        }, 500);
      }
    }
    async function fetchConflict() {
      try {
        const latest = await getRoomNotes(code, token!);
        if (active && status === 'conflict') {
          remote = latest;
          publish();
        }
      } catch {
        // Se conserva el borrador y se permite reintentar la lectura del conflicto.
      }
    }
    async function flush(keepalive = false) {
      clearTimeout(timer);
      if (revision === null || !dirty() || saving || status === 'conflict') return;
      const sentContent = content;
      const sentRevision = revision;
      saving = true;
      status = 'saving';
      publish();
      try {
        const note = await saveRoomNotes(code, token!, sentContent, sentRevision, keepalive);
        revision = note.revision;
        savedContent = sentContent;
        saving = false;
        // Una respuesta de una sesión cerrada no debe borrar un borrador más nuevo.
        const stored = readDraft(storageKey!);
        if (active || (stored?.content === content && stored.revision === sentRevision)) persist();
        status = dirty() ? 'pending' : 'saved';
        publish();
        if (dirty()) {
          if (leaving) void flush(true);
          else schedule();
        }
      } catch (error) {
        saving = false;
        status = error instanceof RoomNotesConflictError ? 'conflict' : 'save-error';
        publish();
        if (status === 'conflict' && active) void fetchConflict();
      }
    }
    async function load() {
      status = 'loading';
      publish();
      try {
        const note = await getRoomNotes(code, token!);
        if (!active) return;
        revision = note.revision;
        savedContent = note.content;
        const draft = readDraft(storageKey!);
        content = draft?.content ?? note.content;
        if (draft && dirty() && draft.revision !== revision) {
          revision = draft.revision;
          remote = note;
          status = 'conflict';
        } else {
          status = dirty() ? 'pending' : 'ready';
          persist();
          schedule();
        }
        publish();
      } catch {
        if (!active) return;
        revision = null;
        status = 'load-error';
        publish();
      }
    }

    const sessionActions: Actions = {
      edit(value) {
        if (revision === null) return;
        content = value;
        if (status !== 'conflict') status = saving ? 'saving' : dirty() ? 'pending' : 'ready';
        persist();
        publish();
        schedule();
      },
      retry() {
        if (status === 'load-error') void load();
        else if (status === 'conflict') void fetchConflict();
        else if (status === 'save-error') void flush();
      },
      resolveConflict(keepLocal) {
        if (!remote) return;
        revision = remote.revision;
        savedContent = remote.content;
        if (!keepLocal) content = remote.content;
        remote = null;
        status = dirty() ? 'pending' : 'ready';
        persist();
        publish();
        if (keepLocal) void flush();
      },
    };
    actions.current = sessionActions;
    const onPageHide = () => {
      leaving = true;
      void flush(true);
    };
    const onPageShow = () => {
      leaving = false;
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty() || saving) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('beforeunload', onBeforeUnload);
    void load();
    return () => {
      active = false;
      leaving = true;
      clearTimeout(timer);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (actions.current === sessionActions) actions.current = null;
      void flush(true);
    };
  }, [code, token, storageKey]);

  const edit = useCallback((content: string) => actions.current?.edit(content), []);
  const retry = useCallback(() => actions.current?.retry(), []);
  const resolveConflict = useCallback(
    (keepLocal: boolean) => actions.current?.resolveConflict(keepLocal),
    [],
  );
  return { ...state, edit, retry, resolveConflict };
}
