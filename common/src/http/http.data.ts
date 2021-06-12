import { HttpStatus } from "@nestjs/common/enums/http-status.enum";
import { IsEnum, IsOptional, Length } from "class-validator";

export class RelayActionResult {
  @IsEnum(HttpStatus) 
  status: HttpStatus;
  
  @IsOptional()
  @Length(0, 500) 
  message?: string;

  @IsOptional()
  data?: any;

  @IsOptional()
  error?: Error[];
}