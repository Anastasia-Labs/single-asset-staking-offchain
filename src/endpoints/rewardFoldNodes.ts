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
import { Result, RewardFoldNodesConfig } from "../core/types.js";
import {
  MIN_ADA,
  TIME_TOLERANCE_MS,
  rFold,
} from "../index.js";

export const rewardFoldNodes = async (
  lucid: Lucid,
  config: RewardFoldNodesConfig
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
    toUnit(rewardFoldPolicyId, rFold)
  );
  if (!rewardUTxO.datum)
    return { type: "error", error: new Error("missing RewardFoldDatum") };

  const oldRewardFoldDatum = Data.from(rewardUTxO.datum, RewardFoldDatum);

  if(oldRewardFoldDatum.currNode.next == null)
    return { type: "error", error: new Error("Rewards fold already completed")}
  
  //NOTE: nodeInputs should be already ordered by keys
  const nodeUTxOs = await lucid.utxosByOutRef(config.nodeInputs);
  
  if(!nodeUTxOs.length)
   return { type: "error", error: new Error("No node UTxOs found") }

  if (!nodeUTxOs[0].datum) return { type: "error", error: new Error("missing datum for first node input") };
  
  const firstNodeDatum = Data.from(nodeUTxOs[0].datum, SetNode);
  if(firstNodeDatum.key !== oldRewardFoldDatum.currNode.next)
    return { type: "error", error: new Error("First input node is not next in line for rewards fold") }

  const lastNode = nodeUTxOs[nodeUTxOs.length - 1].datum;
  if (!lastNode) return { type: "error", error: new Error("missing datum for last node input") };
  const lastNodeDatum = Data.from(lastNode, SetNode);

  const newFoldDatum = Data.to(
    {
      currNode: {
        key: oldRewardFoldDatum.currNode.key,
        next: lastNodeDatum.next,
      },
      totalRewardTokens: oldRewardFoldDatum.totalRewardTokens,
      totalStaked: oldRewardFoldDatum.totalStaked,
      owner: oldRewardFoldDatum.owner,
    },
    RewardFoldDatum
  );
  
  const rewardToken = toUnit(config.rewardCS, fromText(config.rewardTN));
  const stakeToken = toUnit(config.stakeCS, fromText(config.stakeTN));
  const nodeOutIdxs: bigint[]= [];
  let totalOwedReward = 0n;
  
  config.currentTime ??= Date.now();
  const upperBound = config.currentTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currentTime - TIME_TOLERANCE_MS;

  try {
    let tx = lucid
      .newTx()
      .collectFrom(nodeUTxOs, Data.to("RewardFoldAct", NodeValidatorAction));

    nodeUTxOs.forEach((utxo, index) => {
      const owedRewardTokenAmount = (utxo.assets[stakeToken] * oldRewardFoldDatum.totalRewardTokens) /
        oldRewardFoldDatum.totalStaked;
  
      const nodeOutputAssets = {...utxo.assets};
      nodeOutputAssets["lovelace"] = MIN_ADA; // NODE_ADA - FOLDING_FEE

      // nodeOutputAssets[rewardToken] may not be undefined in case stake and reward tokens are one and the same
      nodeOutputAssets[rewardToken] = (nodeOutputAssets[rewardToken] || 0n) + owedRewardTokenAmount;
      totalOwedReward += owedRewardTokenAmount;

      if(!utxo.datum)
        return { type: "error", error: new Error("No datum found for node input") }
      
      tx = tx
        .payToContract(
          nodeValidatorAddr,
          { inline: utxo.datum },
          nodeOutputAssets
        );

      nodeOutIdxs.push(BigInt(index));
    });

    const remainingRewardTokenAmount = rewardUTxO.assets[rewardToken] - totalOwedReward;
    const rewardFoldValidatorRedeemer = Data.to({
      RewardsFoldNodes: {
        nodeIdxs: config.indices.map((index) => {
          return BigInt(index);
        }),
        nodeOutIdxs: nodeOutIdxs
      }
    }, RewardFoldAct);

    tx = tx
      .collectFrom([rewardUTxO], rewardFoldValidatorRedeemer)
      .payToContract(
        rewardFoldValidatorAddr,
        { inline: newFoldDatum },
        {
          ...rewardUTxO.assets,
          [stakeToken]: remainingRewardTokenAmount
        }
      )
      .withdraw(
        lucid.utils.validatorToRewardAddress(stakingStakeValidator),
        0n,
        Data.void()
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
