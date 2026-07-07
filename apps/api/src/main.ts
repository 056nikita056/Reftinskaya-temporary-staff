import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import "reflect-metadata";

import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/api-exception.filter";

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
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  if (config.get<string>("ENABLE_SWAGGER") === "true") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("Reftinskaya Temporary Staff API")
      .setDescription("API для управления временным персоналом")
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api/docs", app, document);
  }

  await app.listen(port);
}

void bootstrap();
