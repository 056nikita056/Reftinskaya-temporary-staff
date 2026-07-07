import { Module } from "@nestjs/common";

import { CompatController } from "./compat.controller";

@Module({
  controllers: [CompatController]
})
export class CompatModule {}
