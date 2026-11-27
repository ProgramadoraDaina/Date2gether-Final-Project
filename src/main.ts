import { AppModule } from './app.module';
import { createApp } from './app-setup';
import { setupSwagger } from './swagger';

async function bootstrap() {
  const app = await createApp(AppModule);
  if (setupSwagger(app)) console.log('Swagger UI available at /docs (public URL: /api/docs)');

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Date2gether API corriendo en http://localhost:${port}`);
}
bootstrap().catch((error: unknown) => {
  console.error('No se pudo iniciar la aplicación', error);
  process.exit(1);
});
