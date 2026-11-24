import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, getRoomMessages, type ChatHistoryPage, type ChatMessage } from '@/lib/api';

const PAGE_SIZE = 50;
const emptyPage: ChatHistoryPage = { entries: [], nextCursor: null };

function searchParams(archive: boolean, day: string, before: string | null) {
  const params = new URLSearchParams({ view: archive ? 'archive' : 'recent' });
  if (before) params.set('before', before);
  if (day) {
    const tomorrow = new Date(`${day}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const start = new Date(`${day}T00:00:00`);
    const end = new Date(`${tomorrow.toISOString().slice(0, 10)}T00:00:00`);
    params.set('from', start.toISOString());
    params.set('to', end.toISOString());
  }
  return params;
}

function appendMessage(page: ChatHistoryPage, message: ChatMessage): ChatHistoryPage {
  if (page.entries.some((entry) => entry.id === message.id)) return page;
  const entries = [...page.entries, message].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  if (entries.length <= PAGE_SIZE) return { ...page, entries };
  const latest = entries.slice(-PAGE_SIZE);
  return { entries: latest, nextCursor: latest[0].id };
}

export function useChatHistory(code: string, token?: string) {
  const [recent, setRecent] = useState(emptyPage);
  const duringJoin = useRef<ChatMessage[] | null>(null);
  const [archive, setArchive] = useState(false);
  const [day, setDay] = useState('');
  const [before, setBefore] = useState<string | null>(null);
  const [result, setResult] = useState<{ page?: ChatHistoryPage; error?: string } | null>(null);
  const useLivePage = !archive && !day && !before;
  const page = useLivePage ? recent : result?.page;

  useEffect(() => {
    if (!token || useLivePage) return;
    const controller = new AbortController();
    getRoomMessages(code, token, searchParams(archive, day, before), controller.signal).then(
      (found) => {
        if (!controller.signal.aborted) setResult({ page: found });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            error: error instanceof ApiError ? error.message : 'No se pudieron cargar los mensajes',
          });
        }
      },
    );
    return () => controller.abort();
  }, [code, token, useLivePage, archive, day, before]);

  const loaded = useMemo(() => {
    if (archive || before || !day || !page) return page;
    const params = searchParams(false, day, null);
    const start = params.get('from')!;
    const end = params.get('to')!;
    return recent.entries.reduce(
      (result, message) =>
        message.createdAt >= start && message.createdAt < end
          ? appendMessage(result, message)
          : result,
      page,
    );
  }, [archive, before, day, page, recent.entries]);

  const startJoin = useCallback(() => {
    duringJoin.current = [];
  }, []);

  const receiveMessage = useCallback((message: ChatMessage) => {
    if (duringJoin.current) duringJoin.current = [...duringJoin.current, message].slice(-PAGE_SIZE);
    setRecent((page) => appendMessage(page, message));
  }, []);

  const receiveHistory = useCallback((page: ChatHistoryPage) => {
    const buffered = duringJoin.current ?? [];
    duringJoin.current = null;
    setRecent(buffered.reduce(appendMessage, page));
  }, []);

  return {
    page: loaded ?? emptyPage,
    loading: !useLivePage && result === null,
    error: useLivePage ? undefined : result?.error,
    archive,
    day,
    before,
    startJoin,
    receiveMessage,
    receiveHistory,
    changeDay(value: string) {
      if (value === day) return;
      setDay(value);
      setBefore(null);
      setResult(null);
    },
    toggleArchive() {
      setArchive(!archive);
      setBefore(null);
      setResult(null);
    },
    goTo(value: string | null) {
      setBefore(value);
      setResult(null);
    },
  };
}
