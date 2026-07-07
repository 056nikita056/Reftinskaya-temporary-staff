import { ConfigService } from "@nestjs/config";

export function requireConfig(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}
