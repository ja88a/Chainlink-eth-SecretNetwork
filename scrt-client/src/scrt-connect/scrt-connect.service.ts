import { Bip39, Random } from '@iov/crypto';
import { Logger, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Account,
  CosmWasmClient,
  encodeSecp256k1Pubkey,
  EnigmaUtils,
  pubkeyToAddress,
  Secp256k1Pen,
  SigningCosmWasmClient,
} from 'secretjs';
import { PubKey } from 'secretjs/types/types';

export const Decimals = {
  COSMOS: 12,
  SCRT_DIV: 1e6,
  DEFAULT: 12,
};

@Injectable()
export class ScrtConnectService {
  private readonly logger = new Logger(ScrtConnectService.name);

  private customFees = {
    upload: {
      amount: [{ amount: '2000000', denom: 'uscrt' }],
      gas: '2000000',
    },
    init: {
      amount: [{ amount: '500000', denom: 'uscrt' }],
      gas: '500000',
    },
    exec: {
      amount: [{ amount: '500000', denom: 'uscrt' }],
      gas: '500000',
    },
    send: {
      amount: [{ amount: '80000', denom: 'uscrt' }],
      gas: '80000',
    },
  };

  constructor(private configService: ConfigService) {}

  /**
   * Create a non-signing connection client to a Secret Network node
   * @param nodeUrl Optional target Secret Network node URL. Else the one set in .env is used
   * @returns a non-signing client
   */
  initScrtClient(nodeUrl?: string): CosmWasmClient {
    const connectUrl = nodeUrl ? nodeUrl : this.configService.get<string>('SECRET_REST_URL');
    return new CosmWasmClient(connectUrl);
  }

  async getProviderInfo(client: CosmWasmClient): Promise<{ chainId: string; height: number }> {
    // Query chain ID
    const chainId = await client.getChainId().catch((err) => {
      throw new Error(`Could not get chain id: ${err}`);
    });

    // Query chain height
    const height = await client.getHeight().catch((err) => {
      throw new Error(`Could not get block height: ${err}`);
    });

    this.logger.log('Connected to SecretNetwork ChainId: ' + chainId + ' at Block height:' + height);

    // Node info
    // const nodeInfo: NodeInfoResponse = await client.restClient.nodeInfo();
    // console.log('Node Info: ', nodeInfo);

    return {
      chainId: chainId,
      height: height,
    };
  }

  private async _initAccountParams(
    random = false,
    _mnemonic?: string,
  ): Promise<{ pubKey: PubKey; address: string; signingPen: Secp256k1Pen }> {
    const mnemonicExt = _mnemonic || this.configService.get<string>('SECRET_MNEMONIC');
    let mnemonic = '';
    if (random || !mnemonicExt) {
      // Create random address and mnemonic
      this.logger.warn('Initializing a random account');
      mnemonic = Bip39.encode(Random.getBytes(16)).toString();
    } else {
      mnemonic = mnemonicExt;
    }

    // This wraps a single keypair and allows for signing.
    const signingPen = await Secp256k1Pen.fromMnemonic(mnemonic).catch((err) => {
      throw new Error(`Could not get signing pen: ${err}`);
    });

    // Get the public key
    const pubkey = encodeSecp256k1Pubkey(signingPen.pubkey);

    // Get the wallet address
    const accAddress = pubkeyToAddress(pubkey, 'secret');

    return {
      pubKey: pubkey,
      address: accAddress,
      signingPen: signingPen,
    };
  }

  async initAccount(client: CosmWasmClient, random = false, _mnemonic?: string): Promise<Account> {
    const accountParams = await this._initAccountParams(random, _mnemonic);
    const account = await client.getAccount(accountParams.address).catch((err) => {
      throw new Error(`Could not get account: ${err}`);
    });

    this.logger.log(
      'Init Account:\t' +
        account +
        '\n\taddress\t' +
        account.address +
        '\n\tbalance: ' +
        account.balance +
        '\n\tpubKey: ' +
        account.pubkey,
    );

    return account;
  }

  async initScrtClientSigning(
    randomAccount = false,
    _mnemonic?: string,
    nodeUrl?: string,
  ): Promise<SigningCosmWasmClient> {
    const connectUrl = nodeUrl ? nodeUrl : this.configService.get<string>('SECRET_REST_URL');
    const accountParams = await this._initAccountParams(randomAccount, _mnemonic);
    const txEncryptionSeed = EnigmaUtils.GenerateNewSeed();

    this.logger.log('Initializing a new ScrtSigningClient - random:' + randomAccount);

    // Create connection to a Secret Network node
    const clientSigning = new SigningCosmWasmClient(
      connectUrl,
      accountParams.address,
      (signBytes) => accountParams.signingPen.sign(signBytes),
      txEncryptionSeed,
    );

    return clientSigning;
  }

  async getClientSigningInfo(client: SigningCosmWasmClient): Promise<{ provider; account: Account }> {
    const provInfo = await this.getProviderInfo(client);
    const account = await client.getAccount();

    const chainId = await client.getChainId();
    const balanceAmount: number = +account.balance[0].amount;
    const balance = new Intl.NumberFormat('en-US', {}).format(balanceAmount / Decimals.SCRT_DIV);
    this.logger.log(
      'Signing client info: \n\tchainId:\t' +
        chainId +
        '\n\tSender: \t' +
        client.senderAddress +
        '\n\tAccount:\t' +
        account.address +
        '\n\tBalance:\t' +
        balance +
        ' ' +
        account.balance[0].denom,
    );

    return {
      provider: provInfo,
      account: account,
    };
  }
}
