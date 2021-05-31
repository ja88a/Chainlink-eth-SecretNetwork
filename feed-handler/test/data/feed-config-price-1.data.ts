import { FeedConfig, EFeedDataType, EFeedSourceType } from '@relayd/common';

/**
 * Sample minimum config of a Chainlink Aggregator Proxy price feed
 * 
 * (Configuration based on the default supported settings)
 */
export const feedConfigPrice_ok_min_1_btcusd: FeedConfig = {
    id: 'cl-eth-price-btcusd-1-aggr-prox',
    name: 'CL-ETH BTC/USD Price feed Aggregator Proxy',
    creator: 'secret1p4ltddczms6hm3e7z3r8cufuwjqq3nq40npaje',
    data: {
        type: EFeedDataType.PRICE,
    },
    source: {
        contract: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    }
};

/**
 * Sample minimum config of a Chainlink Aggregator Proxy price feed on BTC/USD using ENS
 * 
 * Should be similar than 'feedConfigPrice_ok_min_1_btcusd'
 * 
 * (Configuration based on the default supported settings)
 */
 export const feedConfigPrice_ok_min_2_btcusd_ens: FeedConfig = {
    id: 'cl-eth-price-btcusd-1-aggr-prox-ens',
    name: 'CL-ETH BTC/USD Price feed Aggregator Proxy from ENS',
    creator: 'secret1p4ltddczms6hm3e7z3r8cufuwjqq3nq40npaje',
    data: {
        type: EFeedDataType.PRICE,
    },
    source: {
        contract: 'btc-usd.data.eth',
    }
};

/**
 * Sample valid configuration of a Chainlink Aggregator price feed
 * 
 * No intermediate EA Aggregator Proxy contract
 */
export const feedConfigPrice_ok1: FeedConfig = {
    id: 'cl-eth-price-btcusd-1-aggr',
    name: 'CL-ETH BTC/USD Price feed Aggregator',
    description: 'Chainlink price feed Aggregator for BTC/USD as reported on Ethereum', //
    creator: 'secret1p4ltddczms6hm3e7z3r8cufuwjqq3nq40npaje',
    owner: 'secret1p4ltddczms6hm3e7z3r8cufuwjqq3nq40GROUP', // 
    data: {
        type: EFeedDataType.PRICE,
        quote: 'BTC', //
        base: 'USD', //
    },
    source: {
        contract: '0x7104ac4abcecf1680f933b04c214b0c491d43ecc',
        type: EFeedSourceType.CL_AGGR, //
    }
};
