import { ParameterSchema, Schema } from '@tezos-ts/michelson-encoder';
import { ml2mic, sexp2mic } from '@tezos-ts/utils';
import { DEFAULT_FEE, DEFAULT_GAS_LIMIT, DEFAULT_STORAGE_LIMIT } from '../constants';
import { Context } from '../context';
import { format } from '../format';
import { OperationEmitter } from '../operations/operation-emitter';
import { Operation } from '../operations/operations';
import { Contract } from './contract';
import { ContractProvider, ContractSchema } from './interface';
import {
  OriginateParams,
  OriginationOperation,
  DelegateParams,
  DelegateOperation,
  TransferParams,
  TransferOperation,
  ActivateOperation,
} from '../operations/types';

export class RpcContractProvider extends OperationEmitter implements ContractProvider {
  constructor(context: Context) {
    super(context);
  }

  /**
   *
   * @description Return a well formatted json object of the contract storage
   *
   * @param contract contract address you want to get the storage from
   * @param schema optional schema can either be the contract script rpc response or a michelson-encoder schema
   *
   * @see http://tezos.gitlab.io/master/api/rpc.html#get-block-id-context-contracts-contract-id-script
   */
  async getStorage<T>(contract: string, schema?: ContractSchema): Promise<T> {
    if (!schema) {
      schema = await this.rpc.getScript(contract);
    }

    let contractSchema: Schema;
    if (schema instanceof Schema) {
      contractSchema = schema;
    } else {
      contractSchema = Schema.fromRPCResponse({ script: schema });
    }

    const storage = await this.rpc.getStorage(contract);

    return contractSchema.Execute(storage) as T; // Cast into T because only the caller can know the true type of the storage
  }

  /**
   *
   * @description Return a well formatted json object of the contract big map storage
   *
   * @param contract contract address you want to get the storage from
   * @param key contract big map key to fetch value from
   * @param schema optional schema can either be the contract script rpc response or a michelson-encoder schema
   *
   * @see http://tezos.gitlab.io/master/api/rpc.html#get-block-id-context-contracts-contract-id-script
   */
  async getBigMapKey<T>(contract: string, key: string, schema?: ContractSchema): Promise<T> {
    if (!schema) {
      schema = await this.rpc.getScript(contract);
    }

    let contractSchema: Schema;
    if (schema instanceof Schema) {
      contractSchema = schema;
    } else {
      contractSchema = Schema.fromRPCResponse({ script: schema });
    }

    const encodedKey = contractSchema.EncodeBigMapKey(key);

    const val = await this.rpc.getBigMapKey(contract, encodedKey);

    return contractSchema.ExecuteOnBigMapValue(val) as T; // Cast into T because only the caller can know the true type of the storage
  }

  /**
   *
   * @description Originate a new contract according to the script in parameters. Will sign and inject an operation using the current context
   *
   * @returns An operation handle with the result from the rpc node
   *
   * @param OriginationOperation Originate operation parameter
   */
  async originate({
    code,
    init,
    balance = '0',
    spendable = false,
    delegatable = false,
    delegate,
    fee = DEFAULT_FEE.ORIGINATION,
    gasLimit = DEFAULT_GAS_LIMIT.ORIGINATION,
    storageLimit = DEFAULT_STORAGE_LIMIT.ORIGINATION,
  }: OriginateParams) {
    const script = {
      code: Array.isArray(code) ? code : ml2mic(code),
      storage: typeof init === 'object' ? init : sexp2mic(init),
    };

    const publicKeyHash = await this.signer.publicKeyHash();
    const operation: OriginationOperation = {
      kind: 'origination',
      fee,
      gas_limit: gasLimit,
      storage_limit: storageLimit,
      balance: format('tz', 'mutez', balance).toString(),
      manager_pubkey: publicKeyHash,
      spendable,
      delegatable,
      script,
    };

    if (delegate) {
      operation.delegate = delegate;
    }

    const opBytes = await this.prepareOperation({ operation, source: publicKeyHash });
    return this.signAndInject(opBytes);
  }

  /**
   *
   * @description Set the delegate for a contract. Will sign and inject an operation using the current context
   *
   * @returns An operation handle with the result from the rpc node
   *
   * @param SetDelegate operation parameter
   */
  async setDelegate({
    delegate,
    source,
    fee = DEFAULT_FEE.DELEGATION,
    gasLimit = DEFAULT_GAS_LIMIT.DELEGATION,
    storageLimit = DEFAULT_STORAGE_LIMIT.DELEGATION,
  }: DelegateParams) {
    const operation: DelegateOperation = {
      kind: 'delegation',
      source,
      fee,
      gas_limit: gasLimit,
      storage_limit: storageLimit,
      delegate,
    };
    const opBytes = await this.prepareOperation({
      operation,
      source: source || (await this.signer.publicKeyHash()),
    });
    return this.signAndInject(opBytes);
  }

  /**
   *
   * @description Register the current address as delegate. Will sign and inject an operation using the current context
   *
   * @returns An operation handle with the result from the rpc node
   *
   * @param RegisterDelegate operation parameter
   */
  async registerDelegate({
    fee = DEFAULT_FEE.DELEGATION,
    gasLimit = DEFAULT_GAS_LIMIT.DELEGATION,
    storageLimit = DEFAULT_STORAGE_LIMIT.DELEGATION,
  }: any) {
    const operation: DelegateOperation = {
      kind: 'delegation',
      fee,
      gas_limit: gasLimit,
      storage_limit: storageLimit,
      delegate: await this.signer.publicKeyHash(),
    };
    const opBytes = await this.prepareOperation({ operation });
    return this.signAndInject(opBytes);
  }

  /**
   *
   * @description Transfer tz from current address to a specific address. Will sign and inject an operation using the current context
   *
   * @returns An operation handle with the result from the rpc node
   *
   * @param Transfer operation parameter
   */
  async transfer({
    to,
    source,
    amount,
    parameter,
    fee = DEFAULT_FEE.TRANSFER,
    gasLimit = DEFAULT_GAS_LIMIT.TRANSFER,
    storageLimit = DEFAULT_STORAGE_LIMIT.TRANSFER,
    mutez = false,
    rawParam = false,
  }: TransferParams) {
    const operation: TransferOperation = {
      kind: 'transaction',
      fee,
      gas_limit: gasLimit,
      storage_limit: storageLimit,
      amount: mutez ? amount.toString() : format('tz', 'mutez', amount).toString(),
      destination: to,
    };
    if (parameter) {
      operation.parameters = rawParam ? parameter : sexp2mic(parameter);
    }

    const opBytes = await this.prepareOperation({ operation, source });
    return this.signAndInject(opBytes);
  }

  async at(address: string): Promise<any> {
    let script = await this.rpc.getScript(address);

    let contractSchema: Schema = Schema.fromRPCResponse({ script });
    let parameterSchema: ParameterSchema = ParameterSchema.fromRPCResponse({ script });

    return new Contract(address, contractSchema, parameterSchema, this);
  }
}
