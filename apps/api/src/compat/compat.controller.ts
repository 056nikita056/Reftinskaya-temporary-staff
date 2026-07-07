import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { accessForRole, type BootstrapData, type Factory } from "@reftinskaya/contracts";

import type { AccessTokenPayload } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("compat")
@ApiBearerAuth()
@Controller("compat")
export class CompatController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("bootstrap")
  async bootstrap(@CurrentUser() user: AccessTokenPayload): Promise<BootstrapData> {
    const factory = await this.prisma.factory.findUnique({
      where: { id: user.factoryId }
    });
    const apiFactory: Factory | undefined = factory
      ? {
          id: factory.id,
          name: factory.name,
          timezone: factory.timezone,
          theme: factory.theme ?? undefined,
          active: factory.active
        }
      : undefined;
    const permissions = accessForRole(user.role);

    return {
      plans: [],
      sections: [],
      operations: [],
      employees: [],
      employeeBusy: [],
      assignments: [],
      reservations: [],
      housingDorms: [],
      housingPlaces: [],
      facts: [],
      explanations: [],
      currentUser: {
        id: user.sub,
        factoryId: user.factoryId,
        login: user.login,
        role: user.role,
        fullName: user.fullName,
        factory: apiFactory,
        access: permissions
      },
      factory: apiFactory,
      permissions,
      summary: {
        totalBeds: 0,
        occupiedBeds: 0,
        freeBeds: 0,
        personnelToSettle: 0
      }
    };
  }
}
