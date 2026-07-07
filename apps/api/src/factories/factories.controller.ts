import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Factory } from "@reftinskaya/contracts";

import { Public } from "../auth/decorators/public.decorator";
import { FactoriesService } from "./factories.service";

@ApiTags("factories")
@Controller("factories")
export class FactoriesController {
  constructor(private readonly factoriesService: FactoriesService) {}

  @Public()
  @Get()
  findActive(): Promise<Factory[]> {
    return this.factoriesService.findActive();
  }
}
