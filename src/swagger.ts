import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Names of the two security schemes, referenced by @ApiBearerAuth() on controllers. */
export const ACCESS_TOKEN_AUTH = 'access-token';
export const ROOM_PASS_AUTH = 'room-pass';

/** Path where Swagger UI is served (the JSON document lives at `${DOCS_PATH}-json`). */
export const DOCS_PATH = 'docs';

/**
 * Swagger is on by default outside production. In production it must be opted
 * into explicitly with SWAGGER_ENABLED=true, because public docs reveal the API map.
 */
export function isSwaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.SWAGGER_ENABLED?.trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return env.NODE_ENV !== 'production';
}

/**
 * Mounts Swagger UI at /docs and the OpenAPI JSON at /docs-json.
 * Returns false (and mounts nothing) when disabled.
 *
 * The backend has no global prefix: in production Caddy strips `/api` before
 * proxying, so the public URL is /api/docs. Set SWAGGER_SERVER_URL=/api there so
 * "Try it out" calls the right base path.
 */
export function setupSwagger(app: INestApplication, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isSwaggerEnabled(env)) return false;

  const builder = new DocumentBuilder()
    .setTitle('Date2gether API')
    .setDescription(
      [
        'REST API of Date2gether (video rooms, chat, breakout rooms, transcripts and AI call summaries).',
        '',
        'Authentication uses two kinds of Bearer tokens, both sent in the `Authorization` header:',
        '- `access-token`: account JWT (15 min) returned by `POST /auth/login`, `/auth/register` and `/auth/refresh`.',
        '- `room-pass`: short-lived room pass returned by `POST /rooms/{code}/access`; needed by in-call endpoints.',
        '',
        'Use the Authorize button to set them. To test 401, omit the token; to test 403, use a token whose role is not allowed.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Account access token' },
      ACCESS_TOKEN_AUTH,
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Room pass from POST /rooms/{code}/access',
      },
      ROOM_PASS_AUTH,
    );

  const serverUrl = env.SWAGGER_SERVER_URL?.trim();
  if (serverUrl) builder.addServer(serverUrl);

  const document = SwaggerModule.createDocument(app, builder.build());
  SwaggerModule.setup(DOCS_PATH, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
  return true;
}
