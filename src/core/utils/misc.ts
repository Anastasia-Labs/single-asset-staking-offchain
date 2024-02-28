import {
  Address,
  Data,
  Lucid,
  SpendingValidator,
  UTxO,
  fromText,
  toUnit,
} from "@anastasia-labs/lucid-cardano-fork";
import { FoldDatum, RewardFoldDatum, SetNode } from "../contract.types.js";
import { Either, ReadableUTxO, Result } from "../types.js";
import { mkNodeKeyTN } from "./utils.js";
import { CFOLD, RFOLD, RTHOLDER, originNodeTokenName } from "../constants.js";

export const utxosAtScript = async (
  lucid: Lucid,
  script: string,
  stakeCredentialHash?: string,
) => {
  const scriptValidator: SpendingValidator = {
    type: "PlutusV2",
    script: script,
  };

  const scriptValidatorAddr = stakeCredentialHash
    ? lucid.utils.validatorToAddress(
        scriptValidator,
        lucid.utils.keyHashToCredential(stakeCredentialHash),
      )
    : lucid.utils.validatorToAddress(scriptValidator);

  return lucid.utxosAt(scriptValidatorAddr);
};

export const parseSafeDatum = <T>(
  lucid: Lucid,
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
  lucid: Lucid,
  script: string,
  datumType: T,
  stakeCredentialHash?: string,
): Promise<ReadableUTxO<T>[]> => {
  //FIX: this can throw an error if script is empty or not initialized
  const utxos = await utxosAtScript(lucid, script, stakeCredentialHash);
  return utxos.flatMap((utxo) => {
    const result = parseSafeDatum<T>(lucid, utxo.datum, datumType);
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
  lucid: Lucid,
  configTN: string,
  nodeValidatorAddr: Address,
  nodePolicyId: string,
): Promise<Result<UTxO>> => {
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
  lucid: Lucid,
  configTN: string,
  nodeValidatorAddr: Address,
  nodePolicyId: string,
  userKey: string,
  nodeCount: number,
  nodeUTxOs?: UTxO[],
): Promise<Result<UTxO[]>> => {
  if (nodeCount <= 0) return { type: "ok", data: [] };
  if (!userKey) return { type: "error", error: new Error("Missing userKey") };

  const utxos = nodeUTxOs ? nodeUTxOs : await lucid.utxosAt(nodeValidatorAddr);
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
};

export const findCoveringNode = async (
  lucid: Lucid,
  configTN: string,
  nodeValidatorAddr: Address,
  nodePolicyId: string,
  userKey: string,
  nodeUTxOs?: UTxO[],
): Promise<Result<UTxO>> => {
  const utxos = nodeUTxOs ? nodeUTxOs : await lucid.utxosAt(nodeValidatorAddr);

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
};

export const findOwnNode = async (
  lucid: Lucid,
  configTN: string,
  nodeValidatorAddr: Address,
  nodePolicyId: string,
  userKey: string,
  nodeUTxOs?: UTxO[],
): Promise<Result<UTxO>> => {
  let utxos: UTxO[] = [];
  let containsNodeToken = false;
  const nodeToken = toUnit(nodePolicyId, mkNodeKeyTN(userKey));

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
};

export const findPreviousNode = async (
  lucid: Lucid,
  configTN: string,
  nodeValidatorAddr: Address,
  nodePolicyId: string,
  userKey: string,
  nodeUTxOs?: UTxO[],
): Promise<Result<UTxO>> => {
  const utxos = nodeUTxOs ? nodeUTxOs : await lucid.utxosAt(nodeValidatorAddr);

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
};

// TODO make these findUTxO functions use same helper function
export const findTokenHolderUTxO = async (
  lucid: Lucid,
  configTN: string,
  tokenHolderValidatorAddr: Address,
  tokenHolderPolicyId: string,
): Promise<Result<UTxO>> => {
  const utxos = await lucid.utxosAtWithUnit(
    tokenHolderValidatorAddr,
    toUnit(tokenHolderPolicyId, fromText(RTHOLDER)),
  );

  const tokenHolderUTxO = utxos.find((value) => {
    if (value.datum) {
      return value.datum == configTN;
    }
  });

  if (!tokenHolderUTxO || !tokenHolderUTxO.datum)
    return { type: "error", error: new Error("missing tokenHolderUTxO") };
  else return { type: "ok", data: tokenHolderUTxO };
};

export const findFoldUTxO = async (
  lucid: Lucid,
  configTN: string,
  foldValidatorAddr: Address,
  foldPolicyId: string,
): Promise<Result<UTxO>> => {
  const utxos = await lucid.utxosAtWithUnit(
    foldValidatorAddr,
    toUnit(foldPolicyId, fromText(CFOLD)),
  );

  const foldUTxO = utxos.find((value) => {
    if (value.datum) {
      const datum = Data.from(value.datum, FoldDatum);

      return datum.currNode.configTN == configTN;
    }
  });

  if (!foldUTxO || !foldUTxO.datum)
    return { type: "error", error: new Error("missing foldUTxO") };
  else return { type: "ok", data: foldUTxO };
};

export const findRewardFoldUTxO = async (
  lucid: Lucid,
  configTN: string,
  rfoldValidatorAddr: Address,
  rfoldPolicyId: string,
): Promise<Result<UTxO>> => {
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
