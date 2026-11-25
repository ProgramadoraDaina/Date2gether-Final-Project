import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';

export const INTERNAL_ERROR_BODY = {
  statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  message: 'Internal server error',
} as const;

/**
 * Global HTTP exception filter (course requirement R7: errors must never
 * expose stack traces, SQL queries or internal data to the client).
 *
 * - HttpException (validation, auth, throttling, 404...): status and body are
 *   forwarded unchanged, so the response shape clients already rely on stays
 *   identical to Nest's default behavior.
 * - Client errors thrown by body-parser / http-errors (413, 415, bad charset):
 *   non-HttpException objects with a 4xx `status`/`statusCode` and
 *   `expose === true` keep their status, but the body only carries the
 *   standard reason phrase (err.message is never echoed). Logged as warn.
 * - If headers were already sent (handlers using @Res()), nothing can be
 *   written anymore: the error is only logged and the response is closed.
 * - Anything else (Drizzle/pg errors embed the SQL text and parameters in
 *   their message, TypeErrors, etc.): the full error is logged server-side and
 *   the client only gets a fixed generic 500 body.
 *
 * Registered with app.useGlobalFilters(), which Nest applies to HTTP handlers
 * only; the Socket.IO gateway keeps its own error handling. The host type
 * check below is an extra guard so a non-HTTP context is never answered with
 * an HTTP response.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (response.headersSent) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        `Exception after headers were sent on ${request.method} ${request.url}`,
        stack,
      );
      if (!response.writableEnded) response.end();
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const clientStatus = getExposedClientStatus(exception);
    if (clientStatus !== null) {
      this.logger.warn(`Client error ${clientStatus} on ${request.method} ${request.url}`);
      response.status(clientStatus).json({
        statusCode: clientStatus,
        message: STATUS_CODES[clientStatus] ?? 'Bad Request',
      });
      return;
    }

    const stack = exception instanceof Error ? exception.stack : String(exception);
    this.logger.error(`Unhandled exception on ${request.method} ${request.url}`, stack);

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ...INTERNAL_ERROR_BODY });
  }
}

/**
 * Returns the 4xx status of an http-errors style error (body-parser, etc.) or
 * null when the error is not an exposable client error.
 */
function getExposedClientStatus(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const { status, statusCode, expose } = exception as Record<string, unknown>;
  if (expose !== true) return null;
  const value = typeof status === 'number' ? status : statusCode;
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 400 && value <= 499 ? value : null;
}
