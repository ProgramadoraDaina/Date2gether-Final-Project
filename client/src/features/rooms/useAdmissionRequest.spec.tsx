import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import type { AdmissionStatus, RoomAccess } from '@/lib/api';
let getAdmissionStatus: (typeof import('@/lib/api'))['getAdmissionStatus'];
let cancelAdmissionRequest: (typeof import('@/lib/api'))['cancelAdmissionRequest'];
let useAdmissionRequest: (typeof import('./useAdmissionRequest'))['useAdmissionRequest'];

jest.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  getAdmissionStatus: jest.fn(),
  cancelAdmissionRequest: jest.fn(),
}));
const receipt = { status: 'pending' as const, requestId: 'request-1', ticket: 'wait-ticket' };
const granted: RoomAccess = {
  token: 'participant-token',
  participant: { sub: 'request-1', roomCode: 'abc', name: 'Ana' },
};
const admitted = jest.fn<(access: RoomAccess) => void>();
beforeEach(async () => {
  const api = await import('@/lib/api');
  getAdmissionStatus = api.getAdmissionStatus;
  cancelAdmissionRequest = api.cancelAdmissionRequest;
  useAdmissionRequest = (await import('./useAdmissionRequest')).useAdmissionRequest;
  jest.useFakeTimers();
  jest.clearAllMocks();
  sessionStorage.clear();
  jest.mocked(getAdmissionStatus).mockResolvedValue({ status: 'pending' });
  jest.mocked(cancelAdmissionRequest).mockResolvedValue();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('useAdmissionRequest', () => {
  it('consulta la solicitud y solo entrega acceso cuando el servidor confirma admisión', async () => {
    const hook = renderHook(() => useAdmissionRequest('abc', admitted));
    await act(async () => {
      hook.result.current.start(receipt);
    });
    expect(admitted).not.toHaveBeenCalled();
    jest.mocked(getAdmissionStatus).mockResolvedValueOnce({ status: 'admitted', access: granted });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(admitted).toHaveBeenCalledWith(granted);
    expect(admitted).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('date2gether:waiting:abc')).toBeNull();
  });
  it('un rechazo detiene las consultas y necesita una nueva acción de la persona', async () => {
    jest.mocked(getAdmissionStatus).mockResolvedValueOnce({ status: 'rejected' });
    const hook = renderHook(() => useAdmissionRequest('abc', admitted));
    await act(async () => {
      hook.result.current.start(receipt);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(15000);
    });
    expect(hook.result.current.status).toBe('rejected');
    expect(getAdmissionStatus).toHaveBeenCalledTimes(1);
    expect(admitted).not.toHaveBeenCalled();
    act(() => hook.result.current.reset());
    expect(hook.result.current.receipt).toBeNull();
  });
  it('cancelar ignora una admisión que llegó desde una consulta anterior', async () => {
    let resolve!: (result: AdmissionStatus) => void;
    jest.mocked(getAdmissionStatus).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const hook = renderHook(() => useAdmissionRequest('abc', admitted));
    await act(async () => {
      hook.result.current.start(receipt);
    });
    await act(async () => {
      await hook.result.current.cancel();
    });
    await act(async () => {
      resolve({ status: 'admitted', access: granted });
    });
    expect(admitted).not.toHaveBeenCalled();
    expect(hook.result.current.receipt).toBeNull();
  });
  it('recupera la espera al recargar sin crear otra solicitud', async () => {
    sessionStorage.setItem('date2gether:waiting:abc', JSON.stringify(receipt));
    const hook = renderHook(() => useAdmissionRequest('abc', admitted));
    await act(async () => {});
    expect(getAdmissionStatus).toHaveBeenCalledWith('abc', receipt, expect.any(AbortSignal));
    expect(hook.result.current.receipt).toEqual(receipt);
    expect(admitted).not.toHaveBeenCalled();
  });
  it('un error de red conserva la solicitud y se recupera al volver a consultar', async () => {
    jest.mocked(getAdmissionStatus).mockRejectedValueOnce(new Error('offline'));
    const hook = renderHook(() => useAdmissionRequest('abc', admitted));
    await act(async () => {
      hook.result.current.start(receipt);
    });
    expect(hook.result.current.error).toContain('No se pudo consultar');
    expect(hook.result.current.receipt).toEqual(receipt);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(15000);
    });
    expect(hook.result.current.error).toBeNull();
  });
});
