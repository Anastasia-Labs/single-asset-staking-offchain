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
import {
  COMMIT_FOLD_BATCH_SIZE,
  TIME_TOLERANCE_MS,
  findConsecutiveNodes,
  findFoldUTxO,
  getInputUtxoIndices,
} from "../index.js";
import { fetchConfigUTxO } from "./fetchConfig.js";

export const multiFold = async (
  lucid: Lucid,
  config: MultiFoldConfig,
): Promise<Result<TxComplete>> => {
  config.currentTime ??= Date.now();

  const walletUtxos = await lucid.wallet.getUtxos();

  if (!walletUtxos.length)
    return { type: "error", error: new Error("No utxos in wallet") };

  if (
    !config.refScripts.nodeValidator.scriptRef ||
    !config.refScripts.nodePolicy.scriptRef ||
    !config.refScripts.foldValidator.scriptRef ||
    !config.refScripts.foldPolicy.scriptRef
  )
    return { type: "error", error: new Error("Missing Script Reference") };

  const nodeValidator: SpendingValidator =
    config.refScripts.nodeValidator.scriptRef;
  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const nodePolicy: MintingPolicy = config.refScripts.nodePolicy.scriptRef;
  const nodePolicyId = lucid.utils.mintingPolicyToId(nodePolicy);

  const foldValidator: SpendingValidator =
    config.refScripts.foldValidator.scriptRef;
  const foldValidatorAddr = lucid.utils.validatorToAddress(foldValidator);

  const foldPolicy: MintingPolicy = config.refScripts.foldPolicy.scriptRef;
  const foldPolicyId = lucid.utils.mintingPolicyToId(foldPolicy);

  const foldUTxO = await findFoldUTxO(
    lucid,
    config.configTN,
    foldValidatorAddr,
    foldPolicyId,
  );
  if (foldUTxO.type == "error") return foldUTxO;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const oldFoldDatum = Data.from(foldUTxO.data.datum!, FoldDatum);
  const nextNode = oldFoldDatum.currNode.next;

  if (!nextNode)
    return {
      type: "error",
      error: new Error("Commit Fold has already completed."),
    };

  // NOTE: nodeRefUTxOs should be ordered by keys
  const nodeRefUTxOsResponse = await findConsecutiveNodes(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
    nextNode,
    COMMIT_FOLD_BATCH_SIZE,
    config.nodeUTxOs,
  );
  if (nodeRefUTxOsResponse.type == "error") return nodeRefUTxOsResponse;
  const nodeRefUTxOs = nodeRefUTxOsResponse.data;

  const lastNodeRef = nodeRefUTxOs[nodeRefUTxOs.length - 1].datum;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const lastNodeRefDatum = Data.from(lastNodeRef!, SetNode);

  const staked = nodeRefUTxOs.reduce((result: bigint, utxo: UTxO) => {
    return (
      result + utxo.assets[toUnit(config.stakeCS, fromText(config.stakeTN))]
    );
  }, 0n);

  const newFoldDatum = Data.to(
    {
      currNode: {
        key: oldFoldDatum.currNode.key,
        next: lastNodeRefDatum.next,
        configTN: config.configTN,
      },
      staked: oldFoldDatum.staked + staked,
      owner: oldFoldDatum.owner,
    },
    FoldDatum,
  );

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  const refInputIndices = getInputUtxoIndices(nodeRefUTxOs, [
    config.refScripts.foldValidator,
    configUTxOResponse.data,
  ]);

  const redeemerValidator = Data.to(
    {
      FoldNodes: {
        nodeIdxs: refInputIndices,
      },
    },
    FoldAct,
  );

  const upperBound = config.currentTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currentTime - TIME_TOLERANCE_MS;

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([foldUTxO.data], redeemerValidator)
      .readFrom([config.refScripts.foldValidator, configUTxOResponse.data])
      .readFrom(nodeRefUTxOs)
      .payToContract(
        foldValidatorAddr,
        { inline: newFoldDatum },
        foldUTxO.data.assets,
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
