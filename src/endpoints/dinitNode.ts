import {
  Lucid,
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  TxComplete,
  fromText,
} from "@anastasia-labs/lucid-cardano-fork";
import { NODE_ADA, originNodeTokenName } from "../core/constants.js";
import {
  NodeValidatorAction,
  StakingNodeAction,
} from "../core/contract.types.js";
import { DInitNodeConfig, Result } from "../core/types.js";
import { fetchConfigUTxO } from "./fetchConfig.js";
import { findHeadNode } from "../index.js";

export const dinitNode = async (
  lucid: Lucid,
  config: DInitNodeConfig,
): Promise<Result<TxComplete>> => {
  if (
    !config.refScripts.nodeValidator.scriptRef ||
    !config.refScripts.nodePolicy.scriptRef
  )
    return { type: "error", error: new Error("Missing Script Reference") };
  const nodeValidator: SpendingValidator =
    config.refScripts.nodeValidator.scriptRef;
  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const nodePolicy: MintingPolicy = config.refScripts.nodePolicy.scriptRef;
  const nodePolicyId = lucid.utils.mintingPolicyToId(nodePolicy);

  const headNodeUTxO = await findHeadNode(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
  );

  if (headNodeUTxO.type == "error") return headNodeUTxO;

  if (headNodeUTxO.data.assets["lovelace"] == NODE_ADA)
    return {
      type: "error",
      error: new Error("Cannot DeInit Node before Rewards Fold is initiated."),
    };

  const assets = {
    [toUnit(nodePolicyId, originNodeTokenName)]: -1n,
  };

  const redeemerNodePolicy = Data.to("PDInit", StakingNodeAction);

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  const stakeToken = toUnit(config.stakeCS, fromText(config.stakeTN));

  try {
    const tx = await lucid
      .newTx()
      .collectFrom(
        [headNodeUTxO.data],
        Data.to("LinkedListAct", NodeValidatorAction),
      )
      .mintAssets(assets, redeemerNodePolicy)
      .payToAddress(config.penaltyAddress, {
        [stakeToken]: headNodeUTxO.data.assets[stakeToken],
      })
      .readFrom([
        config.refScripts.nodePolicy,
        config.refScripts.nodeValidator,
        configUTxOResponse.data,
      ])
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
