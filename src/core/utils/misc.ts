import {
  Address,
  Data,
  LucidEvolution,
  SpendingValidator,
  TxHash,
  TxSignBuilder,
  UTxO,
  Unit,
  fromText,
  getAddressDetails,
  keyHashToCredential,
  toUnit,
  validatorToAddress,
} from "@lucid-evolution/lucid";
import { FoldDatum, RewardFoldDatum, SetNode } from "../contract.types.js";
import { Either, ReadableUTxO, Result } from "../types.js";
import { mkNodeKeyTN } from "./utils.js";
import { CFOLD, RFOLD, RTHOLDER, originNodeTokenName } from "../constants.js";
import { setTimeout } from "timers/promises";

export const utxosAtScript = async (
  lucid: LucidEvolution,
  script: string,
  stakeCredentialHash?: string,
) => {
  const network = lucid.config().network;

  const scriptValidator: SpendingValidator = {
    type: "PlutusV2",
    script: script,
  };

  const scriptValidatorAddr = stakeCredentialHash
    ? validatorToAddress(network,
        scriptValidator,
        keyHashToCredential(stakeCredentialHash),
      )
    : validatorToAddress(network,scriptValidator);

  return lucid.utxosAt(scriptValidatorAddr);
};

export const parseSafeDatum = <T>(
  datum: string | null | undefined,
  datumType: T,
): Either<string, T> => {
  if (datum) {
    try {
      const parsedDatum = Data.from(datum, datumType);
      return {
        type: "right",
        value: parsedDatum,
      };
    } catch (error) {
      return { type: "left", value: `invalid datum : ${error}` };
    }
  } else {
    return { type: "left", value: "missing datum" };
  }
};

export const parseUTxOsAtScript = async <T>(
  lucid: LucidEvolution,
  script: string,
  datumType: T,
  stakeCredentialHash?: string,
): Promise<ReadableUTxO<T>[]> => {
  //FIX: this can throw an error if script is empty or not initialized
  const utxos = await utxosAtScript(lucid, script, stakeCredentialHash);
  return utxos.flatMap((utxo) => {
    const result = parseSafeDatum<T>(utxo.datum, datumType);
    if (result.type == "right") {
      return {
        outRef: {
          txHash: utxo.txHash,
          outputIndex: utxo.outputIndex,
        },
        datum: result.value,
        assets: utxo.assets,
      };
    } else {
      return [];
    }
  });
};

export type ResultSorted = {
  index: number;
  value: ReadableUTxO<SetNode>;
};

export const sortByDatumKeys = (
  utxos: ResultSorted[],
  startKey: string | null,
) => {
  const firstItem = utxos.find((readableUTxO) => {
    return readableUTxO.value.datum.key == startKey;
  });
  if (!firstItem) throw new Error("firstItem error");
  if (!startKey) throw new Error("startKey error");

  return utxos.reduce(
    (result, current) => {
      if (current.value.datum.next == null) return result;
      const item = utxos.find((readableUTxO) => {
        return (
          readableUTxO.value.datum.key ==
          result[result.length - 1].value.datum.next
        );
      });
      if (!item) throw new Error("item error");
      result.push(item);
      return result;
    },
    [firstItem] as ResultSorted[],
  );
};

//TODO: cleanup function and try to make it generic
//TODO: test with chunkArray
export const sortByOutRefWithIndex = (utxos: ReadableUTxO<SetNode>[]) => {
  const head = utxos.find((utxo) => {
    return utxo.datum.key == null;
  });
  if (!head) throw new Error("head error");

  const sortedByOutRef = utxos
    .filter((utxo) => {
      return head != utxo;
    })
    .sort((a, b) => {
      if (a.outRef.txHash < b.outRef.txHash) {
        return -1;
      } else if (a.outRef.txHash > b.outRef.txHash) {
        return 1;
      } else if (a.outRef.txHash == b.outRef.txHash) {
        if (a.outRef.outputIndex < b.outRef.outputIndex) {
          return -1;
        } else return 1;
      } else return 0;
    })
    .map((value, index) => {
      return {
        value,
        index,
      };
    });

  return sortByDatumKeys(sortedByOutRef, head.datum.next);
};

export const findHeadNode = async (
  lucid: LucidEvolution,
  configTN: string,
  nodeValidatorAddr: Address,
  nodePolicyId: string,
): Promise<Result<UTxO>> => {
  try {
    const utxos = await lucid.utxosAtWithUnit(
      nodeValidatorAddr,
      toUnit(nodePolicyId, originNodeTokenName),
    );

    const headNode = utxos.find((value) => {
      if (value.datum) {
        const datum = Data.from(value.datum, SetNode);

        return datum.configTN == configTN;
      }
    });

    if (!headNode || !headNode.datum)
      return { type: "error", error: new Error("missing headNode") };
    else return { type: "ok", data: headNode };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

/**
 * Provides a map of pubKey hash to UTxO for all the nodes with
 * the given @configTN. All nodes except the head node.
 * @param configTN
 * @param nodePolicyId
 * @param nodeUTxOs
 * @returns
 */
export const getKeyToNodeMap = (
  configTN: string,
  nodePolicyId: string,
  nodeUTxOs: UTxO[],
): Map<string, UTxO> => {
  const keyNodeMap: Map<string, UTxO> = new Map();

  nodeUTxOs.forEach((utxo) => {
    if (utxo.datum) {
      const datum = Data.from(utxo.datum, SetNode);
      if (
        datum.key &&
        datum.configTN == configTN &&
        utxo.assets[toUnit(nodePolicyId, mkNodeKeyTN(datum.key))] == BigInt(1)
      )
        keyNodeMap.set(datum.key, utxo);
    }
  });

  return keyNodeMap;
};

/**
 * Provides the next consecutive nodes ("nodeCount" or till end is reached)
 * in order, starting from "userKey"
 *
 * @param lucid
 * @param configTN Nodes belonging to a particular staking campaign
 * @param nodeValidatorAddr
 * @param nodePolicyId
 * @param userKey The pubKeyHash value of the node from where the list needs to
 * start.
 * @param nodeCount Number of consecutive nodes to be returned.
 * @param nodeUTxOs
 * @returns
 */
export const findConsecutiveNodes = async (
  lucid: LucidEvolution,
  configTN: string,
  nodeValidatorAddr: Address,
  nodePolicyId: string,
  userKey: string,
  nodeCount: number,
  nodeUTxOs?: UTxO[],
): Promise<Result<UTxO[]>> => {
  if (nodeCount <= 0) return { type: "ok", data: [] };
  if (!userKey) return { type: "error", error: new Error("Missing userKey") };
  try {
    const utxos = nodeUTxOs
      ? nodeUTxOs
      : await lucid.utxosAt(nodeValidatorAddr);
    const keyNodeMap = getKeyToNodeMap(configTN, nodePolicyId, utxos);
    const consecutiveNodes: UTxO[] = [];
    let nextKey = userKey;

    for (let i = 0; i < nodeCount; i++) {
      const nextNode = keyNodeMap.get(nextKey);

      if (nextNode && nextNode.datum) {
        consecutiveNodes.push(nextNode);

        const datum = Data.from(nextNode.datum, SetNode);
        if (datum.next == null) break;

        nextKey = datum.next;
      } else {
        return {
          type: "error",
          error: new Error("Missing Consecutive Node/ Node Datum"),
        };
      }
    }

    return { type: "ok", data: consecutiveNodes };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

export const findCoveringNode = async (
  lucid: LucidEvolution,
  configTN: string,
  nodeValidatorAddr: Address,
  nodePolicyId: string,
  userKey: string,
  nodeUTxOs?: UTxO[],
): Promise<Result<UTxO>> => {
  try {
    const utxos = nodeUTxOs
      ? nodeUTxOs
      : await lucid.utxosAt(nodeValidatorAddr);

    const coveringNode = utxos.find((value) => {
      if (value.datum) {
        const datum = Data.from(value.datum, SetNode);

        return (
          datum.configTN == configTN &&
          (datum.key == null || datum.key < userKey) &&
          (datum.next == null || userKey < datum.next) &&
          value.assets[
            toUnit(
              nodePolicyId,
              datum.key ? mkNodeKeyTN(datum.key) : originNodeTokenName,
            )
          ] == BigInt(1)
        );
      }
    });

    if (!coveringNode || !coveringNode.datum)
      return { type: "error", error: new Error("missing coveringNode") };
    else return { type: "ok", data: coveringNode };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

export const findOwnNode = async (
  lucid: LucidEvolution,
  configTN: string,
  nodeValidatorAddr: Address,
  nodePolicyId: string,
  userKey: string,
  nodeUTxOs?: UTxO[],
): Promise<Result<UTxO>> => {
  let utxos: UTxO[] = [];
  let containsNodeToken = false;
  const nodeToken = toUnit(nodePolicyId, mkNodeKeyTN(userKey));
  try {
    if (nodeUTxOs) utxos = nodeUTxOs;
    else {
      utxos = await lucid.utxosAtWithUnit(nodeValidatorAddr, nodeToken);
      containsNodeToken = true;
    }

    const node = utxos.find((utxo) => {
      if (containsNodeToken || utxo.assets[nodeToken] == BigInt(1)) {
        if (utxo.datum) {
          const datum = Data.from(utxo.datum, SetNode);
          return datum.configTN == configTN;
        }
      }
    });

    if (!node || !node.datum)
      return { type: "error", error: new Error("missing node") };
    else return { type: "ok", data: node };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

export const findPreviousNode = async (
  lucid: LucidEvolution,
  configTN: string,
  nodeValidatorAddr: Address,
  nodePolicyId: string,
  userKey: string,
  nodeUTxOs?: UTxO[],
): Promise<Result<UTxO>> => {
  try {
    const utxos = nodeUTxOs
      ? nodeUTxOs
      : await lucid.utxosAt(nodeValidatorAddr);

    const previousNode = utxos.find((value) => {
      if (value.datum) {
        const datum = Data.from(value.datum, SetNode);

        return (
          datum.configTN == configTN &&
          userKey == datum.next &&
          value.assets[
            toUnit(
              nodePolicyId,
              datum.key ? mkNodeKeyTN(datum.key) : originNodeTokenName,
            )
          ] == BigInt(1)
        );
      }
    });

    if (!previousNode || !previousNode.datum)
      return { type: "error", error: new Error("missing previousNode") };
    else return { type: "ok", data: previousNode };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

// TODO make these findUTxO functions use same helper function
export const findTokenHolderUTxO = async (
  lucid: LucidEvolution,
  configTN: string,
  tokenHolderValidatorAddr: Address,
  tokenHolderPolicyId: string,
): Promise<Result<UTxO>> => {
  try {
    const utxos = await lucid.utxosAtWithUnit(
      tokenHolderValidatorAddr,
      toUnit(tokenHolderPolicyId, fromText(RTHOLDER)),
    );

    const tokenHolderUTxO = utxos.find((value) => {
      if (value.datum) {
        return Data.from(value.datum) == configTN;
      }
    });

    if (!tokenHolderUTxO || !tokenHolderUTxO.datum)
      return { type: "error", error: new Error("missing tokenHolderUTxO") };
    else return { type: "ok", data: tokenHolderUTxO };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

export const findFoldUTxO = async (
  lucid: LucidEvolution,
  configTN: string,
  foldValidatorAddr: Address,
  foldPolicyId: string,
  walletAddr?: Address,
): Promise<Result<UTxO>> => {
  try {
    const utxos = await lucid.utxosAtWithUnit(
      foldValidatorAddr,
      toUnit(foldPolicyId, fromText(CFOLD)),
    );

    let pubKeyHash: string | undefined;

    if (walletAddr) {
      pubKeyHash =
        getAddressDetails(walletAddr).paymentCredential?.hash;

      if (!pubKeyHash)
        return { type: "error", error: new Error("User PubKeyHash not found") };
    }

    const foldUTxO = utxos.find((value) => {
      if (value.datum) {
        const datum = Data.from(value.datum, FoldDatum);

        if (datum.currNode.configTN == configTN) {
          const ownerCred = datum.owner.paymentCredential;
          if (pubKeyHash) {
            return (
              "PublicKeyCredential" in ownerCred &&
              pubKeyHash == ownerCred.PublicKeyCredential[0]
            );
          } else return true;
        }
      }
    });

    if (!foldUTxO || !foldUTxO.datum)
      return {
        type: "error",
        error: new Error(
          "missing foldUTxO" + (walletAddr ? "under given owner" : ""),
        ),
      };
    else return { type: "ok", data: foldUTxO };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

export const findRewardFoldUTxO = async (
  lucid: LucidEvolution,
  configTN: string,
  rfoldValidatorAddr: Address,
  rfoldPolicyId: string,
): Promise<Result<UTxO>> => {
  try {
    const utxos = await lucid.utxosAtWithUnit(
      rfoldValidatorAddr,
      toUnit(rfoldPolicyId, fromText(RFOLD)),
    );

    const rfoldUTxO = utxos.find((value) => {
      if (value.datum) {
        const datum = Data.from(value.datum, RewardFoldDatum);

        return datum.currNode.configTN == configTN;
      }
    });

    if (!rfoldUTxO || !rfoldUTxO.datum)
      return { type: "error", error: new Error("missing rfoldUTxO") };
    else return { type: "ok", data: rfoldUTxO };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

// TODO fix stake calculation when stake and reward token are the same
// after rewards claim is done. (No rewardFold UTxO datum to fetch total stake)
export const calculateTotalStake = async (
  lucid: LucidEvolution,
  configTN: string,
  stakeToken: Unit,
  nodeValidatorAddr: Address,
  nodePolicyId: string,
  nodeUTxOs?: UTxO[],
): Promise<Result<number>> => {
  try {
    const utxos = nodeUTxOs
      ? nodeUTxOs
      : await lucid.utxosAt(nodeValidatorAddr);

    let totalStake = 0;
    utxos.forEach((value) => {
      const datumRes = parseSafeDatum(value.datum, SetNode);

      if (datumRes.type == "right") {
        const datum = datumRes.value;

        if (
          datum.configTN == configTN &&
          datum.key &&
          value.assets[toUnit(nodePolicyId, mkNodeKeyTN(datum.key))] ==
            BigInt(1)
        )
          totalStake += Number(value.assets[stakeToken]);
      }
    });

    return { type: "ok", data: totalStake };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

export const chunkArray = <T>(array: T[], chunkSize: number) => {
  const numberOfChunks = Math.ceil(array.length / chunkSize);

  return [...Array(numberOfChunks)].map((value, index) => {
    return array.slice(index * chunkSize, (index + 1) * chunkSize);
  });
};

export const replacer = (key: unknown, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

export const divCeil = (a: bigint, b: bigint) => {
  return 1n + (a - 1n) / b;
};

export async function timeoutAsync<T>(
  asyncFunction: () => Promise<T>,
  timeoutMs: number,
): Promise<Result<T>> {
  const race = await Promise.race([
    asyncFunction(),
    setTimeout(timeoutMs, new Error("timeout async")),
  ]);
  return race instanceof Error
    ? { type: "error", error: race }
    : { type: "ok", data: race };
}

export async function safeAsync<T>(
  asyncFunction: () => Promise<T>,
): Promise<Result<T>> {
  try {
    const data = await asyncFunction();
    return { type: "ok", data };
  } catch (error) {
    return {
      type: "error",
      error: error instanceof Error ? error : new Error(JSON.stringify(error)),
    };
  }
}

// The below structure allows for modular error handling and
// it adds type safety for async functions and timeouts async functions
export async function signSubmitValidate(
  lucid: LucidEvolution,
  txComplete: Result<TxSignBuilder>,
): Promise<Result<TxHash>> {
  if (txComplete.type == "error") return txComplete;

  const txSigned = await safeAsync(async () =>
    txComplete.data.sign.withWallet().complete(),
  );
  if (txSigned.type == "error") return txSigned;

  const submitted = await safeAsync(async () => txSigned.data.submit());
  if (submitted.type == "error") return submitted;

  const awaited = await timeoutAsync(
    async () => lucid.awaitTx(submitted.data),
    120_000,
  );
  if (awaited.type == "error") return awaited;

  return { type: "ok", data: submitted.data };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function catchErrorHandling(error: any, errorMsg: string): Result<any> {
  if (error instanceof Error) return { type: "error", error: error };
  else
    return {
      type: "error",
      error: new Error(errorMsg + JSON.stringify(error)),
    };
}
