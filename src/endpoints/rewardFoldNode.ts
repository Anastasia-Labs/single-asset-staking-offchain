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
import { Result, RewardFoldNodeConfig } from "../core/types.js";
import {
  MIN_ADA,
  TIME_TOLERANCE_MS,
  rFold,
} from "../index.js";

export const rewardFoldNode = async (
  lucid: Lucid,
  config: RewardFoldNodeConfig
): Promise<Result<TxComplete>> => {
  const nodeValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.nodeValidator,
  };
  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const nodeInputs = config.nodeInputs
    ? config.nodeInputs
    : await lucid.utxosAt(nodeValidatorAddr);

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
    toUnit(rewardFoldPolicyId, rFold)
  );
  if (!rewardUTxO.datum)
    return { type: "error", error: new Error("missing RewardFoldDatum") };

  const oldRewardFoldDatum = Data.from(rewardUTxO.datum, RewardFoldDatum);

  if(oldRewardFoldDatum.currNode.next == null)
    return { type: "error", error: new Error("Rewards fold already completed")}

  const nodeInput = nodeInputs.find((utxo) => {
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
        key: oldRewardFoldDatum.currNode.key,
        next: nodeDatum.next,
      },
      totalRewardTokens: oldRewardFoldDatum.totalRewardTokens,
      totalStaked: oldRewardFoldDatum.totalStaked,
      owner: oldRewardFoldDatum.owner,
    },
    RewardFoldDatum
  );
  
  const rewardToken = toUnit(config.rewardCS, fromText(config.rewardTN));
  const stakeToken = toUnit(config.stakeCS, fromText(config.stakeTN));
  const nodeStake = nodeInput.assets[stakeToken];

  const owedRewardTokenAmount =
    (nodeStake * oldRewardFoldDatum.totalRewardTokens) /
    oldRewardFoldDatum.totalStaked;

  const nodeOutputAssets = {...nodeInput.assets};
  nodeOutputAssets["lovelace"] = MIN_ADA; // NODE_ADA - FOLDING_FEE
  
  // nodeOutputAssets[rewardToken] may not be undefined in case stake and reward tokens are one and the same
  nodeOutputAssets[rewardToken] = (nodeOutputAssets[rewardToken] || 0n) + owedRewardTokenAmount;

  const remainingRewardTokenAmount = rewardUTxO.assets[rewardToken] - owedRewardTokenAmount;

  config.currentTime ??= Date.now();
  const upperBound = config.currentTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currentTime - TIME_TOLERANCE_MS;

  try {
    const tx = lucid
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
          ...rewardUTxO.assets,
          [stakeToken]: remainingRewardTokenAmount
        }
      )
      .payToContract(
        nodeValidatorAddr,
        { inline: nodeInput.datum },
        nodeOutputAssets
      )
      .compose(
        config.refScripts?.rewardFoldValidator
          ? lucid.newTx().readFrom([config.refScripts.rewardFoldValidator])
          : lucid.newTx().attachSpendingValidator(rewardFoldValidator)
      )
      .compose(
        config.refScripts?.nodeValidator
          ? lucid.newTx().readFrom([config.refScripts.nodeValidator])
          : lucid.newTx().attachSpendingValidator(nodeValidator)
      )
      .compose(
        config.refScripts?.stakingStakeValidator
          ? lucid.newTx().readFrom([config.refScripts.stakingStakeValidator])
          : lucid.newTx().attachWithdrawalValidator(stakingStakeValidator)
      )
      .validFrom(lowerBound)
      .validTo(upperBound)

    return { 
      type: "ok", 
      data: await 
            (
              process.env.NODE_ENV == "emulator" 
                ? tx.complete() 
                : tx.complete({nativeUplc : false})
            )
      };

  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
