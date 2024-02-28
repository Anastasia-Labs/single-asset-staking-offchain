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
import { StakingNodeAction, SetNode } from "../core/contract.types.js";
import { InitNodeConfig, Result } from "../core/types.js";
import { fetchConfigUTxO } from "./fetchConfig.js";

export const initNode = async (
  lucid: Lucid,
  config: InitNodeConfig,
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
  //              , "configTN" ':= PTokenName
  //              ]
  //         )
  //     )
  const datum = Data.to(
    {
      key: null,
      next: null,
      configTN: config.configTN,
    },
    SetNode,
  );

  const redeemerNodePolicy = Data.to("PInit", StakingNodeAction);
  const stakeToken = toUnit(config.stakeCS, fromText(config.stakeTN));

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([config.stakingInitUTXO])
      .payToContract(
        nodeValidatorAddr,
        { inline: datum },

        {
          ...assets,
          lovelace: NODE_ADA,
          [stakeToken]: BigInt(config.minimumStake), // Evey node must have minimum stake commitment
        },
      )
      .mintAssets(assets, redeemerNodePolicy)
      .readFrom([config.refScripts.nodePolicy, configUTxOResponse.data])
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
