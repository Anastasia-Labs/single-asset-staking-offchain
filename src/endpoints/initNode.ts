import {
  Lucid,
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  TxComplete,
} from "@anastasia-labs/lucid-cardano-fork";
import { EXACT_ADA_COMMITMENT, originNodeTokenName } from "../core/constants.js";
import { StakingNodeAction, SetNode } from "../core/contract.types.js";
import { InitNodeConfig, Result } from "../core/types.js";

export const initNode = async (
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

  const assets = {
    [toUnit(nodePolicyId, originNodeTokenName)]: 1n,
  };

  // data PStakingSetNode (s :: S)
  // = PStakingSetNode
  //     ( Term
  //         s
  //         ( PDataRecord
  //             '[ "key" ':= PNodeKey
  //              , "next" ':= PNodeKey
  //              ]
  //         )
  //     )
  const datum = Data.to(
    {
      key: null,
      next: null,
    },
    SetNode
  );

  const redeemerNodePolicy = Data.to("PInit", StakingNodeAction);

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([config.initUTXO])
      .payToContract(
        nodeValidatorAddr,
        { inline: datum },
        { ...assets, lovelace: EXACT_ADA_COMMITMENT }
      )
      .mintAssets(assets, redeemerNodePolicy)
      .compose(
        config.refScripts?.nodePolicy
          ? lucid.newTx().readFrom([config.refScripts.nodePolicy])
          : lucid.newTx().attachMintingPolicy(nodePolicy)
      )
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
