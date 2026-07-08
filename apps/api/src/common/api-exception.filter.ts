import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import type { Response } from "express";

type ErrorBody = {
  code: string;
  message: string;
};

type ResponsePayload = {
  statusCode: number;
  error: string;
} & ErrorBody;

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = this.bodyForException(exception, status);

    response.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? "Error",
      ...body
    } satisfies ResponsePayload);
  }

  private bodyForException(exception: unknown, status: number): ErrorBody {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (isErrorBody(response)) {
        return response;
      }
      if (isNestErrorResponse(response)) {
        return {
          code: codeForStatus(status),
          message: Array.isArray(response.message) ? response.message.join("; ") : response.message
        };
      }
      if (typeof response === "string") {
        return {
          code: codeForStatus(status),
          message: response
        };
      }
    }

    return {
      code: codeForStatus(status),
      message: status === HttpStatus.INTERNAL_SERVER_ERROR ? "Внутренняя ошибка сервера" : "Ошибка запроса"
    };
  }
}

function isErrorBody(value: unknown): value is ErrorBody {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}

function isNestErrorResponse(value: unknown): value is { message: string | string[] } {
  return isRecord(value) && (typeof value.message === "string" || Array.isArray(value.message));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function codeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "BAD_REQUEST";
    case HttpStatus.UNAUTHORIZED:
      return "UNAUTHORIZED";
    case HttpStatus.FORBIDDEN:
      return "FORBIDDEN";
    case HttpStatus.NOT_FOUND:
      return "NOT_FOUND";
    case HttpStatus.CONFLICT:
      return "CONFLICT";
    default:
      return "INTERNAL_ERROR";
  }
}
