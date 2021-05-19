import { ValidatorOptions } from "class-validator";
import { KafkaOptions } from "@nestjs/microservices";
/**
 * Broker Kafka Server Configuration
 */
export declare const configKafka: KafkaOptions;
/**
 * Data Object IO validation
 */
export declare const VALID_OPT: ValidatorOptions;
/**
 * Possible config values for the External communication of the service's runtime errors
 */
export declare enum EErrorExt {
    DEBUG = "debug",
    STANDARD = "standard",
    DENY = "deny",
    default = "debug"
}
//# sourceMappingURL=clRelay.config.d.ts.map