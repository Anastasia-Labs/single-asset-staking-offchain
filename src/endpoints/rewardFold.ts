import {
  Lucid,
  SpendingValidator,
  Data,
  TxComplete,
  MintingPolicy,
  fromText,
  toUnit,
  WithdrawalValidator,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  NodeValidatorAction,
  SetNode,
  RewardFoldDatum,
  RewardFoldAct
} from "../core/contract.types.js";
import { Result, RewardFoldConfig } from "../core/types.js";
import {
  FOLDING_FEE_ADA,
  NODE_ADA,
  PROTOCOL_PAYMENT_KEY,
  PROTOCOL_STAKE_KEY,
} from "../index.js";

export const rewardFold = async (
  lucid: Lucid,
  config: RewardFoldConfig
): Promise<Result<TxComplete>> => {
  const nodeValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.nodeValidator,
  };
  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const rewardFoldValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.rewardFoldValidator,
  };
  const rewardFoldValidatorAddr =
    lucid.utils.validatorToAddress(rewardFoldValidator);

  const rewardFoldPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: config.scripts.rewardFoldPolicy,
  };
  const rewardFoldPolicyId = lucid.utils.mintingPolicyToId(rewardFoldPolicy);

  const stakingStakeValidator: WithdrawalValidator = {
    type: "PlutusV2",
    script: config.scripts.stakingStakeValidator,
  };

  const [rewardUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress(rewardFoldValidator),
    toUnit(lucid.utils.mintingPolicyToId(rewardFoldPolicy), fromText("RFold"))
  );
  if (!rewardUTxO.datum)
    return { type: "error", error: new Error("missing RewardFoldDatum") };

  const oldRewardFoldDatum = Data.from(rewardUTxO.datum, RewardFoldDatum);

  const nodeInput = config.nodeInputs.find((utxo) => {
    if (utxo.datum) {
      const nodeDatum = Data.from(utxo.datum, SetNode);
      return nodeDatum.key == oldRewardFoldDatum.currNode.next;
    }
  });

  if (!nodeInput?.datum)
    return { type: "error", error: new Error("missing SetNodeDatum") };

  const nodeDatum = Data.from(nodeInput.datum, SetNode);
  const newFoldDatum = Data.to(
    {
      currNode: {
        key: nodeDatum.key,
        next: nodeDatum.next,
      },
      totalRewardTokens: oldRewardFoldDatum.totalRewardTokens,
      totalStaked: oldRewardFoldDatum.totalStaked,
      owner: oldRewardFoldDatum.owner,
    },
    RewardFoldDatum
  );

  const nodeCommitment = nodeInput.assets["lovelace"] - NODE_ADA;
  // console.log("nodeCommitment", nodeCommitment);
  const owedRewardTokenAmount =
    (nodeCommitment * oldRewardFoldDatum.totalRewardTokens) /
    oldRewardFoldDatum.totalStaked;
  // console.log("owedRewardTokenAmount", owedRewardTokenAmount);

  const [nodeAsset] = Object.entries(nodeInput.assets).filter(
    ([key, value]) => {
      return key != "lovelace";
    }
  );

  const remainingRewardTokenAmount =
    rewardUTxO.assets[toUnit(config.rewardCS, fromText(config.rewardTN))] -
    owedRewardTokenAmount;

  try {
    if (oldRewardFoldDatum.currNode.next != null) {
      const tx = await lucid
        .newTx()
        .collectFrom([nodeInput], Data.to("RewardFoldAct", NodeValidatorAction))
        .collectFrom([rewardUTxO], Data.to("RewardsFoldNode", RewardFoldAct))
        .withdraw(
          lucid.utils.validatorToRewardAddress(stakingStakeValidator),
          0n,
          Data.void()
        )
        .payToContract(
          rewardFoldValidatorAddr,
          { inline: newFoldDatum },
          {
            ["lovelace"]: rewardUTxO.assets["lovelace"],
            [toUnit(
              lucid.utils.mintingPolicyToId(rewardFoldPolicy),
              fromText("RFold")
            )]: 1n,
            [toUnit(config.rewardCS, fromText(config.rewardTN))]:
              remainingRewardTokenAmount,
          }
        )
        .payToContract(
          nodeValidatorAddr,
          { inline: nodeInput.datum },
          {
            [nodeAsset[0]]: nodeAsset[1],
            [toUnit(config.rewardCS, fromText(config.rewardTN))]:
              owedRewardTokenAmount,
            ["lovelace"]: NODE_ADA - FOLDING_FEE_ADA,
          }
        )
        .payToAddress(config.rewardAddress, { lovelace: nodeCommitment })
        .payToAddress(
          lucid.utils.credentialToAddress(
            lucid.utils.keyHashToCredential(PROTOCOL_PAYMENT_KEY),
            lucid.utils.keyHashToCredential(PROTOCOL_STAKE_KEY)
          ),
          {
            lovelace: FOLDING_FEE_ADA,
          }
        )
        .readFrom([config.refScripts.rewardFoldValidator])
        .readFrom([config.refScripts.nodeValidator])
        .readFrom([config.refScripts.stakingStakeValidator]);

      return { 
        type: "ok", 
        data: await 
              (
                process.env.NODE_ENV == "emulator" 
                  ? tx.complete() 
                  : tx.complete({nativeUplc : false})
              )
        };
    } else {
      const tx = await lucid
        .newTx()
        .collectFrom([nodeInput], Data.to("RewardFoldAct", NodeValidatorAction))
        .collectFrom([rewardUTxO], Data.to("RewardsReclaim", RewardFoldAct))
        .withdraw(
          lucid.utils.validatorToRewardAddress(stakingStakeValidator),
          0n,
          Data.void()
        )
        .payToContract(
          nodeValidatorAddr,
          { inline: nodeInput.datum },
          {
            [nodeAsset[0]]: nodeAsset[1],
            [toUnit(config.rewardCS, fromText(config.rewardTN))]:
              rewardUTxO.assets[
                toUnit(config.rewardCS, fromText(config.rewardTN))
              ],
            ["lovelace"]: NODE_ADA - FOLDING_FEE_ADA,
          }
        )
        .payToAddress(config.rewardAddress, { lovelace: nodeCommitment })
        .payToAddress(
          lucid.utils.credentialToAddress(
            lucid.utils.keyHashToCredential(PROTOCOL_PAYMENT_KEY),
            lucid.utils.keyHashToCredential(PROTOCOL_STAKE_KEY)
          ),
          {
            lovelace: FOLDING_FEE_ADA,
          }
        )
        .readFrom([config.refScripts.rewardFoldValidator])
        .readFrom([config.refScripts.nodeValidator])
        .readFrom([config.refScripts.stakingStakeValidator])
        .addSigner(await lucid.wallet.address())
        .complete();
      return { type: "ok", data: tx };
    }
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
