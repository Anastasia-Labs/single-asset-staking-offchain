import {
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  LucidEvolution,
  validatorToAddress,
  mintingPolicyToId,
  TxSignBuilder,
} from "@lucid-evolution/lucid";
import { cFold, TIME_TOLERANCE_MS } from "../core/constants.js";
import { FoldDatum, FoldMintAct, SetNode } from "../core/contract.types.js";
import { InitFoldConfig, Result } from "../core/types.js";
import { findHeadNode, fromAddress } from "../index.js";
import { fetchConfigUTxO } from "./fetchConfig.js";

export const initFold = async (
  lucid: LucidEvolution,
  config: InitFoldConfig,
): Promise<Result<TxSignBuilder>> => {
  const network = lucid.config().network;

  config.currentTime ??= Date.now();

  if (
    !config.refScripts.nodeValidator.scriptRef ||
    !config.refScripts.nodePolicy.scriptRef ||
    !config.refScripts.foldValidator.scriptRef ||
    !config.refScripts.foldPolicy.scriptRef
  )
    return { type: "error", error: new Error("Missing Script Reference") };

  const nodeValidator: SpendingValidator =
    config.refScripts.nodeValidator.scriptRef;
  const nodeValidatorAddr = validatorToAddress(network,nodeValidator);

  const nodePolicy: MintingPolicy = config.refScripts.nodePolicy.scriptRef;
  const nodePolicyId = mintingPolicyToId(nodePolicy);

  const headNodeUTxO = await findHeadNode(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
  );
  if (headNodeUTxO.type == "error") return headNodeUTxO;

  const foldValidator: SpendingValidator =
    config.refScripts.foldValidator.scriptRef;
  const foldValidatorAddr = validatorToAddress(network,foldValidator);

  const foldPolicy: MintingPolicy = config.refScripts.foldPolicy.scriptRef;
  const foldPolicyId = mintingPolicyToId(foldPolicy);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const currentNode = Data.from(headNodeUTxO.data.datum!, SetNode);

  const datum = Data.to(
    {
      currNode: currentNode,
      staked: 0n,
      owner: fromAddress(await lucid.wallet().address()), //NOTE: owner is not being used in fold minting or validator
    },
    FoldDatum,
  );

  const redeemerFoldPolicy = Data.to("MintFold", FoldMintAct);

  const assets = {
    [toUnit(foldPolicyId, cFold)]: 1n,
  };

  const upperBound = config.currentTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currentTime - TIME_TOLERANCE_MS;

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  try {
    const tx = await lucid
      .newTx()
      .readFrom([headNodeUTxO.data])
      .pay.ToContract(foldValidatorAddr, { kind: "inline", value: datum }, assets)
      .mintAssets(assets, redeemerFoldPolicy)
      .readFrom([config.refScripts.foldPolicy, configUTxOResponse.data])
      .validFrom(lowerBound)
      .validTo(upperBound)
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
