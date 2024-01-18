import {
  Lucid,
  SpendingValidator,
  Data,
  TxComplete,
  MintingPolicy,
  fromText,
  toUnit,
  UTxO,
} from "@anastasia-labs/lucid-cardano-fork";
import { FoldAct, FoldDatum, SetNode } from "../core/contract.types.js";
import { MultiFoldConfig, Result } from "../core/types.js";
import { CFOLD, TIME_TOLERANCE_MS } from "../index.js";

export const multiFold = async (
  lucid: Lucid,
  config: MultiFoldConfig
): Promise<Result<TxComplete>> => {
  config.currenTime ??= Date.now();

  const walletUtxos = await lucid.wallet.getUtxos();

  if (!walletUtxos.length)
    return { type: "error", error: new Error("No utxos in wallet") };

  const foldValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.foldValidator,
  };

  const foldPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: config.scripts.foldPolicy,
  };

  const foldValidatorAddr = lucid.utils.validatorToAddress(foldValidator);

  const [foldUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress(foldValidator),
    toUnit(lucid.utils.mintingPolicyToId(foldPolicy), fromText(CFOLD))
  );

  if (!foldUTxO || !foldUTxO.datum)
    return { type: "error", error: new Error("missing foldUTxO") };

  const oldFoldDatum = Data.from(foldUTxO.datum, FoldDatum);

  //NOTE: node nodeRefUTxOs shuold be already ordered by keys, utxo type is better than outref since outref does not holds datum information, not sure yet if using utxo though
  const nodeRefUTxOs = await lucid.utxosByOutRef(config.nodeRefInputs);

  const lastNodeRef = nodeRefUTxOs[config.indices.length - 1].datum;
  if (!lastNodeRef) return { type: "error", error: new Error("missing datum") };

  const lastNodeRefDatum = Data.from(lastNodeRef, SetNode);
  // console.log("lastNodeRefDatum", lastNodeRefDatum )
  const committed = nodeRefUTxOs.reduce((result: bigint, utxo: UTxO) => {
    return result + utxo.assets.lovelace - 3_000_000n;
  }, 0n);
  // console.log("committed", committed);

  const newFoldDatum = Data.to(
    {
      currNode: {
        key: oldFoldDatum.currNode.key,
        next: lastNodeRefDatum.next,
      },
      committed: oldFoldDatum.committed + committed,
      owner: oldFoldDatum.owner,
    },
    FoldDatum
  );
  // console.log("indices", config.indices);

  const redeemerValidator = Data.to(
    {
      FoldNodes: {
        nodeIdxs: config.indices.map((index) => {
          return BigInt(index);
        }),
      },
    },
    FoldAct
  );

  const upperBound = config.currenTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currenTime - TIME_TOLERANCE_MS;

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([foldUTxO], redeemerValidator)
      .attachSpendingValidator(foldValidator)
      .readFrom(nodeRefUTxOs)
      .payToContract(
        foldValidatorAddr,
        { inline: newFoldDatum },
        foldUTxO.assets
      )
      .validFrom(lowerBound)
      .validTo(upperBound)
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
