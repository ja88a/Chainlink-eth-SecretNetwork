import { ConfigService } from '@nestjs/config';
import { Contract, ethers, Event, EventFilter, Signer } from 'ethers';
import { Result } from 'ethers/lib/utils';
export declare const CstPair: {
    BTCUSD: string;
    ETHUSD: string;
    LINKUSD: string;
};
export declare const Decimals: {
    FIAT: number;
    ETH: number;
    DEFAULT: number;
};
export declare class EthConnectService {
    private configService;
    private readonly logger;
    constructor(configService: ConfigService);
    initProvider(): ethers.providers.Provider;
    initSigner(provider: ethers.providers.Provider, random: boolean): Signer;
    logProviderConnection(provider: ethers.providers.Provider): void;
    private contractAddr;
    initOracleContractList(network?: string, contractAddrExt?: Map<string, string>): void;
    getContractAddrList(): Map<string, string>;
    private oracleContracts;
    initOracleContracts(provider: ethers.providers.Provider): Map<string, Contract>;
    getOracleContracts(): Map<string, Contract>;
    private oracleContractData;
    loadAllContractData(oracleContractMap?: Map<string, Contract>): Promise<Map<string, Result>>;
    loadOracleLatestRoundData(key: string, contract: Contract, resultCollector?: Map<string, Result>): Promise<Result>;
    getOracleContractData(): Map<string, Result>[];
    listenToEvent(contract: Contract, eventFilter: EventFilter): void;
    listenEventOracleAnswerUpdated(contractOracle: Contract): void;
    loadContractEvent(contract: Contract, eventId: string, overMaxPastBlock?: number): Promise<Event[]>;
    loadEventAnswerUpdated(contractOracle: Contract, overMaxPastBlock?: number): Promise<Event[]>;
    loadLogEventAnswerUpdated(contract: Contract, maxNbResults: number, overMaxNbBlocks?: number, nbBlockPerLogReq?: number): Promise<{
        roundId: number;
        value: number;
        updatedAt: number;
    }[]>;
}
//# sourceMappingURL=eth-connect.service.d.ts.map