import { Data, Lucid, SpendingValidator, UTxO } from "@anastasia-labs/lucid-cardano-fork";
import { SetNode } from "../contract.types.js";
import { Either, ReadableUTxO, Result } from "../types.js";

export const utxosAtScript = async (
  lucid: Lucid,
  script: string,
  stakeCredentialHash?: string
) => {
  const scriptValidator: SpendingValidator = {
    type: "PlutusV2",
    script: script,
  };

  const scriptValidatorAddr = stakeCredentialHash
    ? lucid.utils.validatorToAddress(
        scriptValidator,
        lucid.utils.keyHashToCredential(stakeCredentialHash)
      )
    : lucid.utils.validatorToAddress(scriptValidator);

  return lucid.utxosAt(scriptValidatorAddr);
};

export const parseSafeDatum = <T>(
  lucid: Lucid,
  datum: string | null | undefined,
  datumType: T
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
  stakeCredentialHash?: string
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
  startKey: string | null
) => {
  const firstItem = utxos.find((readableUTxO) => {
    return readableUTxO.value.datum.key == startKey;
  });
  if (!firstItem) throw new Error("firstItem error");
  if (!startKey) throw new Error("startKey error")

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
    [firstItem] as ResultSorted[]
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

  return sortByDatumKeys(sortedByOutRef, head.datum.next)
};

export const findCoveringNode = (nodeUTxOs : UTxO[], userKey: string): Result<UTxO> => {
  const coveringNode = nodeUTxOs.find((value) => {
    if (value.datum) {
      const datum = Data.from(value.datum, SetNode);
      return (
        (datum.key == null || datum.key < userKey) &&
        (datum.next == null || userKey < datum.next)
      );
    }
  });

  if (!coveringNode || !coveringNode.datum)
    return { type: "error", error: new Error("missing coveringNode") };
  else
    return { type: "ok", data: coveringNode }
}

export const findOwnNode = (nodeUTxOs : UTxO[], userKey: string): Result<UTxO> => {
  const node = nodeUTxOs.find((value) => {
    if (value.datum) {
      const datum = Data.from(value.datum, SetNode);
      return datum.key !== null && datum.key == userKey;
    }
  });

  if (!node || !node.datum)
    return { type: "error", error: new Error("missing node") };
  else
    return { type: "ok", data: node }
}

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
