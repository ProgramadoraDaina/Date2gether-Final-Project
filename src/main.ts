import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(
    helmet({
      // API consumida desde otro origen (frontend en :3002): sin esto, el navegador
      // bloquea la lectura de las respuestas por Cross-Origin-Resource-Policy.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? '*' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Date2gether API corriendo en http://localhost:${port}`);
}
bootstrap().catch((error: unknown) => {
  console.error('No se pudo iniciar la aplicación', error);
  process.exit(1);
});
