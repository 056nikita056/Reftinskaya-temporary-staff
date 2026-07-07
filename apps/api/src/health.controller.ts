import { Controller, Get } from "@nestjs/common";

import { Public } from "./auth/decorators/public.decorator";

type HealthResponse = {
  status: "ok";
};

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  getHealth(): HealthResponse {
    return { status: "ok" };
  }
}
