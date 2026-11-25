import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  type ArgumentsHost,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function makeHost(type: string = 'http', headersSent = false) {
  const end = vi.fn();
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    getType: () => type,
    switchToHttp: () => ({
      getResponse: () => ({ status, headersSent, writableEnded: false, end }),
      getRequest: () => ({ method: 'GET', url: '/rooms' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json, end };
}

describe('AllExceptionsFilter', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards an HttpException status and body unchanged', () => {
    const { host, status, json } = makeHost();
    const exception = new BadRequestException(['name must be a string']);

    new AllExceptionsFilter().catch(exception, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(exception.getResponse());
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('keeps other HttpException statuses (403)', () => {
    const { host, status, json } = makeHost();

    new AllExceptionsFilter().catch(new ForbiddenException('nope'), host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ statusCode: 403, message: 'nope', error: 'Forbidden' });
  });

  it('answers a generic Error with a fixed 500 body and no internals', () => {
    const { host, status, json } = makeHost();

    new AllExceptionsFilter().catch(new TypeError('Cannot read properties of undefined'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
  });

  it('does not leak SQL text from a query error', () => {
    const { host, json } = makeHost();
    const error = new Error('Failed query: select "password_hash" from "users" where "id" = $1');
    Object.assign(error, { cause: new Error('relation "users" does not exist') });

    new AllExceptionsFilter().catch(error, host);

    const payload = JSON.stringify(json.mock.calls[0][0]);
    expect(payload).not.toMatch(/select|password_hash|users|Failed query/i);
  });

  it('logs the full error with stack, method and url server-side', () => {
    const { host } = makeHost();
    const error = new Error('boom');

    new AllExceptionsFilter().catch(error, host);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('GET /rooms'), error.stack);
  });

  it('ignores non-http contexts', () => {
    const { host, status } = makeHost('ws');

    new AllExceptionsFilter().catch(new Error('boom'), host);

    expect(status).not.toHaveBeenCalled();
  });

  describe('exposed client errors (body-parser / http-errors)', () => {
    const clientError = (status: number, expose: boolean, key = 'status') =>
      Object.assign(new Error('request entity too large: secret detail'), {
        [key]: status,
        expose,
      });

    it('413 with expose true keeps the status with a generic message', () => {
      const { host, status, json } = makeHost();

      new AllExceptionsFilter().catch(clientError(413, true), host);

      expect(status).toHaveBeenCalledWith(413);
      expect(json).toHaveBeenCalledWith({ statusCode: 413, message: 'Payload Too Large' });
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('reads statusCode as well as status', () => {
      const { host, status, json } = makeHost();

      new AllExceptionsFilter().catch(clientError(415, true, 'statusCode'), host);

      expect(status).toHaveBeenCalledWith(415);
      expect(json).toHaveBeenCalledWith({ statusCode: 415, message: 'Unsupported Media Type' });
    });

    it('never leaks err.message', () => {
      const { host, json } = makeHost();

      new AllExceptionsFilter().catch(clientError(413, true), host);

      expect(JSON.stringify(json.mock.calls[0][0])).not.toMatch(/secret detail/);
      expect(warnSpy.mock.calls.flat().join(' ')).not.toMatch(/secret detail/);
    });

    it('4xx with expose false becomes a generic 500', () => {
      const { host, status, json } = makeHost();

      new AllExceptionsFilter().catch(clientError(400, false), host);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
      expect(errorSpy).toHaveBeenCalled();
    });

    it('503 with expose true becomes a generic 500', () => {
      const { host, status, json } = makeHost();

      new AllExceptionsFilter().catch(clientError(503, true), host);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
    });
  });

  it('does not write when headers were already sent; logs and ends the response', () => {
    const { host, status, json, end } = makeHost('http', true);
    const error = new Error('late failure');

    new AllExceptionsFilter().catch(error, host);

    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('GET /rooms'), error.stack);
    expect(end).toHaveBeenCalled();
  });
});
