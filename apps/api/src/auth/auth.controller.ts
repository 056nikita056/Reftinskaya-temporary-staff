import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";

import type { AccessTokenPayload, ApiLoginResponse, AuthenticatedRequest, OkResponse } from "./auth.types";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./decorators/current-user.decorator";
import { Public } from "./decorators/public.decorator";
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RefreshDto, ResetPasswordDto, SelectFactoryDto } from "./dto/auth.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<ApiLoginResponse> {
    return this.authService.login(dto, requestMeta(request));
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<ApiLoginResponse> {
    return this.authService.refresh(dto);
  }

  @ApiBearerAuth()
  @Post("select-factory")
  @HttpCode(200)
  selectFactory(@CurrentUser() user: AccessTokenPayload, @Body() dto: SelectFactoryDto, @Req() request: Request): Promise<ApiLoginResponse> {
    return this.authService.selectFactory(user, dto.factoryId, requestMeta(request));
  }

  @ApiBearerAuth()
  @Post("logout")
  @HttpCode(200)
  logout(@CurrentUser() user: AccessTokenPayload, @Req() request: AuthenticatedRequest): Promise<OkResponse> {
    return this.authService.logout(user, requestMeta(request));
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<OkResponse> {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<OkResponse> {
    return this.authService.resetPassword(dto);
  }

  @ApiBearerAuth()
  @Post("change-password")
  @HttpCode(200)
  changePassword(@CurrentUser() user: AccessTokenPayload, @Body() dto: ChangePasswordDto): Promise<OkResponse> {
    return this.authService.changePassword(user, dto);
  }
}

function requestMeta(request: Request) {
  return {
    ip: request.ip,
    userAgent: request.get("user-agent")
  };
}
