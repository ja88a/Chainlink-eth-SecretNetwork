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

/**
 * Maximum number of recast of a source contract config
 * to other clients, when the expected network support is not supported.
 */
// TODO Review that non-sense number: must consider nb of eth clients available or have topic contract filters / stream
export const maxRecast_networkSourceNotMatching = 4;

/** Max number of days since last update of contract's data in order 
 * to be considered as valid, i.e. not stall and so rejected */
export const contractDataLastUpdateMaxDays = 30;

/**
 * Maximum number of recast of a source contract config
 * to other clients, when the expected network support is not supported.
 */
 export const maxRecast_contractHandlingFail = 2;