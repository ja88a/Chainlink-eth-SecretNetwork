import { HttpStatus } from "@nestjs/common";
export declare type TMessageType0 = {
    id: string;
    name: string;
};
declare class RelayActionResult {
    status: HttpStatus;
    message?: string;
    data?: any;
    error?: Error[];
}
export declare class DataFeedEnableResult extends RelayActionResult {
}
export declare enum EDataFeedUpdMode {
    LISTEN = "listen",
    PULL = "pull",
    default = "listen"
}
export declare enum EFeedDataType {
    PRICE = "price",
    default = "price"
}
export declare class FeedConfigData {
    type: EFeedDataType;
    quote?: string;
    base?: string;
}
export declare enum EFeedSourceNetwork {
    ETH_MAIN = "eth-mainnet",
    ETH_TEST_RINKEBY = "eth-testnet-rinkeby",
    ETH_TEST_KOVAN = "eth-testnet-kovan",
    BSC_MAIN = "bsc-mainnet",
    default = "eth-mainnet"
}
export declare enum EFeedSourceType {
    CL_AGGR_PROX = "cl-aggregator-proxy",
    CL_AGGR = "cl-aggregator",
    default = "cl-aggregator-proxy"
}
export declare enum EFeedSourceEvent {
    ANSWER_UPDATED = "AnswerUpdated(int256,uint256,uint256)",
    CUSTOM = "custom",
    default = "AnswerUpdated(int256,uint256,uint256)"
}
export declare enum EFeedSourcePoll {
    EVENT = "event",
    PERIOD = "period",
    default = "event"
}
export declare enum EFeedSourceNotifOn {
    CHANGE = "change",
    CHECK = "check",
    default = "change"
}
export declare enum EFeedSourceFunction {
    LATEST_ROUND_DATA = "latestRoundData"
}
export declare class FeedConfigSourceData {
    /** Data path to the field value */
    path?: string;
    /** Number of Decimals for the data values */
    decimals?: Number;
    /** Last data value set */
    value?: unknown;
    /** Last time the source data value was reported as changed */
    time?: Number;
}
export declare class FeedConfigSource {
    /** Source status, in terms of access to its functions and data */
    status?: HttpStatus;
    /** Hosting network of the data Source (contract) */
    network?: EFeedSourceNetwork;
    /** Address of the source contract */
    contract: string;
    /** Type of the source contract */
    type?: EFeedSourceType;
    /** Polling mode to check for data changes: via listening to events or regularly querying the source contract */
    poll?: EFeedSourcePoll;
    /** Event type to listen to, if source is monitored via events */
    event?: EFeedSourceEvent;
    /** Custom event signature to listen to */
    eventSignature?: string;
    /** Poll time period (seconds), if source is monitored via regular polling */
    period?: Number;
    /** Optional specification of the source contract method to use when querying */
    function?: EFeedSourceFunction;
    /** Notification mode of the source contract value: every time it is checked or only when its value has changed (default) */
    notif?: EFeedSourceNotifOn;
    /** The source contract data info and values */
    data: FeedConfigSourceData;
}
export declare enum EFeedTargetNetwork {
    SCRT_MAIN = "scrt-mainnet",
    SCRT_TEST = "scrt-holodeck-2",
    default = "scrt-holodeck-2"
}
export declare enum EFeedTargetType {
    CL_RELAY = "cl-relay",
    CL_PRICE_AGGR_RELAY = "price cl-aggregator-relay",
    CUSTOM = "custom",
    default = "price cl-aggregator-relay"
}
export declare class FeedConfigTargetData {
    /** Number of Decimals for the data values */
    decimals?: Number;
    /** Last data value set */
    value?: unknown;
    /** Last time the target data value was updated */
    time?: Number;
}
export declare class FeedConfigTarget {
    /** Target status, in terms of access to its functions and data */
    status?: HttpStatus;
    /** Target contract address */
    contract?: string;
    /** Network hosting the feed's target contract */
    network?: EFeedTargetNetwork;
    type?: EFeedTargetType;
    typeCustom?: string;
    /** The source contract data info and values */
    data?: FeedConfigTargetData;
}
export declare class FeedConfig {
    id: string;
    version?: Number;
    name: string;
    updateMode?: EDataFeedUpdMode;
    description?: string;
    creator: string;
    owner: string;
    data: FeedConfigData;
    source: FeedConfigSource;
}
export declare class ContractUpdate {
    /** The feed the contract's update relates to */
    feed: string;
    version: Number;
    author: string;
    /** Address of the source contract emiting a data value update */
    source?: string;
    /** Address of the target contract emiting a data value update */
    target?: string;
    /** Last extracted data value(s) */
    value: unknown;
    /** Epoch time when the source value was detected as updated on source or updated on target */
    time: Number;
}
export {};
//# sourceMappingURL=clRelay.data.d.ts.map