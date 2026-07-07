import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import "reflect-metadata";

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const frontendOrigin = config.get<string>("FRONTEND_ORIGIN") ?? "http://localhost:8095";
  const port = Number(config.get<string>("PORT") ?? 8096);

  app.setGlobalPrefix("api/v1");
  app.enableCors({
    origin: frontendOrigin,
    credentials: true
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true
    })
  );
  app.enableShutdownHooks();

  await app.listen(port);
}

void bootstrap();
