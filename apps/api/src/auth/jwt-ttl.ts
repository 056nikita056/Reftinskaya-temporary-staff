import type { StringValue } from "ms";

export function jwtExpiresIn(value: string): StringValue | number {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  return value as StringValue;
}
