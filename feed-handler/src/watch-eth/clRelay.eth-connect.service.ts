import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EthConnectService } from "@ja88a/clrelay-ethereum-client";
import { Client, ClientKafka } from "@nestjs/microservices";
import { configKafka } from "src/jobhandler/clRelay.config";

@Injectable()
export class RelayEthConnectService extends EthConnectService {
  private readonly logger = new Logger(RelayEthConnectService.name);

  @Client(configKafka)
  private client: ClientKafka;

  async init() {
    const requestPatterns = [
      'entity-created',
      'test.send.msg',
    ];

    requestPatterns.forEach(pattern => {
      this.client.subscribeToResponseOf(pattern);
    });

    //await this.client.connect();
  }
}