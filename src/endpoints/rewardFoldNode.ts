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
import { fetchConfigUTxO } from "./fetchConfig.js";

export const rewardFoldNode = async (
  lucid: Lucid,
  config: RewardFoldNodeConfig
): Promise<Result<TxComplete>> => {
  if(!config.refScripts.nodeValidator.scriptRef)
    return { type: "error", error: new Error("Missing Script Reference") }
  const nodeValidator: SpendingValidator = config.refScripts.nodeValidator.scriptRef;
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

  const nodeStakeValidator: WithdrawalValidator = {
    type: "PlutusV2",
    script: config.scripts.nodeStakeValidator,
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

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if(configUTxOResponse.type == "error")
    return configUTxOResponse;

  try {
    const tx = lucid
      .newTx()
      .collectFrom([nodeInput], Data.to("RewardFoldAct", NodeValidatorAction))
      .collectFrom([rewardUTxO], Data.to("RewardsFoldNode", RewardFoldAct))
      .withdraw(
        lucid.utils.validatorToRewardAddress(nodeStakeValidator),
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
        config.refScripts?.nodeStakeValidator
          ? lucid.newTx().readFrom([config.refScripts.nodeStakeValidator])
          : lucid.newTx().attachWithdrawalValidator(nodeStakeValidator)
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
