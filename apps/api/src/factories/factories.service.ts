import { Injectable } from "@nestjs/common";
import type { Factory } from "@reftinskaya/contracts";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class FactoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(): Promise<Factory[]> {
    const factories = await this.prisma.factory.findMany({
      where: { active: true },
      orderBy: { name: "asc" }
    });

    return factories.map((factory) => ({
      id: factory.id,
      name: factory.name,
      timezone: factory.timezone,
      theme: factory.theme ?? undefined,
      active: factory.active
    }));
  }
}
