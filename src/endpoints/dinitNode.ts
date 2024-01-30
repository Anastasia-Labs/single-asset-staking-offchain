import {
  Lucid,
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  TxComplete,
} from "@anastasia-labs/lucid-cardano-fork";
import { originNodeTokenName } from "../core/constants.js";
import { StakingNodeAction, SetNode } from "../core/contract.types.js";
import { InitNodeConfig, Result } from "../core/types.js";

export const dinitNode = async (
  lucid: Lucid,
  config: InitNodeConfig
): Promise<Result<TxComplete>> => {
  const nodeValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.nodeValidator,
  };

  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const nodePolicy: MintingPolicy = {
    type: "PlutusV2",
    script: config.scripts.nodePolicy,
  };

  const nodePolicyId = lucid.utils.mintingPolicyToId(nodePolicy);

  const emptySetUTXO = await lucid.utxosAtWithUnit(
    nodeValidatorAddr,
    toUnit(nodePolicyId, originNodeTokenName)
  );

  if (!emptySetUTXO.length)
    return { type: "error", error: new Error("Head node token not found at validator address: " + nodeValidatorAddr) };

  const assets = {
    [toUnit(nodePolicyId, originNodeTokenName)]: -1n
  };

  const redeemerNodePolicy = Data.to("PDInit", StakingNodeAction);

  try {
    const tx = await lucid
      .newTx()
      .collectFrom(emptySetUTXO)
      .mintAssets(assets, redeemerNodePolicy)
      .attachMintingPolicy(nodePolicy)
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
