import { ValidatorOptions } from 'class-validator';

/**
 * Data Object IO validation
 */
// TODO PROD Review settings
export const VALID_OPT: ValidatorOptions = {
  skipMissingProperties: false,
  whitelist: true,
  forbidNonWhitelisted: true,
  //groups: string[],
  dismissDefaultMessages: true,
  validationError: {
    target: true,
    value: true,
  },
  forbidUnknownValues: true, // PROD: true
  stopAtFirstError: true
};

/**
 * Possible config values for the External communication of the service's runtime errors
 */
export enum EErrorExt {
  DEBUG = 'debug',
  STANDARD = 'standard',
  DENY = 'deny',
  // TODO PROD Change to STD or DENY
  default = STANDARD
};