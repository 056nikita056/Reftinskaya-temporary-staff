import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

import type { AccessTokenPayload } from "../auth.types";
import { requireConfig } from "../auth.config";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireConfig(config, "JWT_ACCESS_SECRET")
    });
  }

  validate(payload: AccessTokenPayload): AccessTokenPayload {
    return payload;
  }
}
