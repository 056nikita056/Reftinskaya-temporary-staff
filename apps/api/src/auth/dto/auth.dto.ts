import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { USER_ROLES } from "@reftinskaya/contracts";
import { IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

const userRoles = [...USER_ROLES];

export class LoginDto {
  @ApiProperty({ example: "admin" })
  @IsString()
  login!: string;

  @ApiProperty({ example: "admin12345" })
  @IsString()
  password!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  factoryId?: string;

  @ApiPropertyOptional({ enum: userRoles })
  @IsOptional()
  @IsIn(userRoles)
  role?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: "admin" })
  @IsString()
  login!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  oldPassword!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
