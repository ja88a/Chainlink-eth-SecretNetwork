//import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Catch } from '@nestjs/common/decorators/core/catch.decorator';
import { Injectable } from '@nestjs/common/decorators/core/injectable.decorator';
import { HttpStatus } from '@nestjs/common/enums/http-status.enum';
import { HttpException } from '@nestjs/common/exceptions/http.exception';
import { ExceptionFilter } from '@nestjs/common/interfaces/exceptions/exception-filter.interface';
import { ArgumentsHost } from '@nestjs/common/interfaces/features/arguments-host.interface';
import { Logger } from '@nestjs/common/services/logger.service';

import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

import { EExternalCommunicationMode, RelaydConfigService } from '../config/relayd.config';

@Catch(Error)
export class HttpExceptionFilterCust implements ExceptionFilter {

  private readonly logger = new Logger(HttpExceptionFilterCust.name);

  private readonly errorComMode: string;

  private static instance: Map<string, HttpExceptionFilterCust>;

  static for(instanceId?: string): HttpExceptionFilterCust {
    const instId: string = instanceId || '*'
    if (this.instance === undefined)
      this.instance = new Map();
    let inst = this.instance.get(instId);
    if (inst == undefined)
      inst = new HttpExceptionFilterCust(instId);
      this.instance.set(instId, inst);
    return inst;
  }

  constructor(instanceId?: string) {
    const configService = new ConfigService();
    this.errorComMode = configService.get<string>('APP_EXTERNAL_COM_MODE') || EExternalCommunicationMode.default;
    this.logger.log('External errors communication mode for \''+instanceId+'\': '+this.errorComMode);
  }

  catch(exception: any, host: ArgumentsHost): any {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let respStatus: number = -1;
    let respBody: any = null;

    switch (this.errorComMode) {
      case EExternalCommunicationMode.STANDARD:
        respStatus = (exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR);
        respBody = {
          statusCode: respStatus,
          message: 'Cannot '+request.method+' '+request.path,
          error: exception.name,
        };
        break;
      case EExternalCommunicationMode.DEBUG:
        respStatus = (exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR);
        respBody = (exception instanceof HttpException ? exception.getResponse() : exception);
        respBody.time = new Date().toISOString();
        respBody.request = {
          path: request.url,
          method: request.method,
          body: request.body,
          params: request.params,
          query: request.query,
          headers: request.headers,
          xhr: request.xhr,
          ip: request.ip,
          ips: request.ips,
        }; 
        break;
      default:
        respStatus = HttpStatus.NOT_FOUND; 
        respBody = {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Cannot '+request.method+' '+request.path,
          error: 'Not Found'
        };
        break;
    }
    response.status(respStatus);
    response.json(respBody);
    //response.send();

    this.logger.warn('Returned error \''+respStatus+'\'\n' + JSON.stringify(respBody));
    this.logger.error('\n'+exception.stack);
    //throw Error(exception);
  }
}



@Injectable()
export class HttpExceptionService {
  private readonly errorExtMode: string;

  constructor(private configService: RelaydConfigService) {
    this.errorExtMode = configService.appExternalCommunicationMode;// || EExternalCommunicationMode.default;
  }

  deny(): HttpException {
    return new HttpException({
      status: HttpStatus.NOT_FOUND,
    }, HttpStatus.NOT_FOUND);
  }

  serverError(errorCode: HttpStatus, input?: any, error?: Error): HttpException {
    let exception = null;
    switch (this.errorExtMode) {
      case EExternalCommunicationMode.STANDARD:
        exception = new HttpException({
          status: errorCode,
          message: 'Internal Server Error'
        }, errorCode);
        break;
      case EExternalCommunicationMode.DEBUG:
        const errorTmp = (error === undefined ? new Error('Internal Server Error') : error);
        //if (error === undefined)
        //  error = new Error('Internal Server Error');
        exception = new HttpException({
          status: errorCode,
          name: errorTmp.name,
          message: errorTmp.message,
          input: input,
          stack: errorTmp.stack,
          error: error
        }, errorCode);
        break;
      default:
        exception = this.deny();
        break;
    }
    return exception;
  }

  clientError(errorCode: HttpStatus, input?: any, error?: Error): HttpException {
    let exception = null;
    switch (this.errorExtMode) {
      case EExternalCommunicationMode.STANDARD:
        exception = new HttpException({
          status: errorCode,
          name: 'Client Error'
        }, errorCode);
        break;
      case EExternalCommunicationMode.DEBUG:
        if (error === undefined)
          error = new Error('Client Request Error');
        exception = new HttpException({
          status: errorCode,
          name: error.name,
          message: error.message,
          input: input,
          stack: error.stack,
          error: error
        }, errorCode);
        break;
      default:
        exception = this.deny();
        break;
    }
    return exception;
  }
}