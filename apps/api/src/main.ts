import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const origin = config.get<string>("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
  app.enableCors({ origin, credentials: true });

  await app.listen(config.get<number>("PORT") ?? 4000);
}

void bootstrap();
