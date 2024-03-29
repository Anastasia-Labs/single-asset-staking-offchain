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
  RewardFoldAct,
} from "../core/contract.types.js";
import { Result, RewardFoldNodeConfig } from "../core/types.js";
import {
  MIN_ADA,
  TIME_TOLERANCE_MS,
  findOwnNode,
  findRewardFoldUTxO,
} from "../index.js";
import { fetchConfigUTxO } from "./fetchConfig.js";

export const rewardFoldNode = async (
  lucid: Lucid,
  config: RewardFoldNodeConfig,
): Promise<Result<TxComplete>> => {
  if (
    !config.refScripts.nodeValidator.scriptRef ||
    !config.refScripts.nodePolicy.scriptRef ||
    !config.refScripts.nodeStakeValidator.scriptRef ||
    !config.refScripts.rewardFoldPolicy.scriptRef ||
    !config.refScripts.rewardFoldValidator.scriptRef
  )
    return { type: "error", error: new Error("Missing Script Reference") };
  const nodeValidator: SpendingValidator =
    config.refScripts.nodeValidator.scriptRef;
  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const nodePolicy: MintingPolicy = config.refScripts.nodePolicy.scriptRef;
  const nodePolicyId = lucid.utils.mintingPolicyToId(nodePolicy);

  const nodeUTxOs = config.nodeUTxOs
    ? config.nodeUTxOs
    : await lucid.utxosAt(nodeValidatorAddr);

  const rewardFoldValidator: SpendingValidator =
    config.refScripts.rewardFoldValidator.scriptRef;
  const rewardFoldValidatorAddr =
    lucid.utils.validatorToAddress(rewardFoldValidator);

  const rewardFoldPolicy: MintingPolicy =
    config.refScripts.rewardFoldPolicy.scriptRef;
  const rewardFoldPolicyId = lucid.utils.mintingPolicyToId(rewardFoldPolicy);

  const nodeStakeValidator: WithdrawalValidator =
    config.refScripts.nodeStakeValidator.scriptRef;

  const rewardUTxO = await findRewardFoldUTxO(
    lucid,
    config.configTN,
    rewardFoldValidatorAddr,
    rewardFoldPolicyId,
  );
  if (rewardUTxO.type == "error") return rewardUTxO;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const oldRewardFoldDatum = Data.from(rewardUTxO.data.datum!, RewardFoldDatum);

  if (oldRewardFoldDatum.currNode.next == null)
    return {
      type: "error",
      error: new Error("Rewards fold already completed"),
    };

  const ownNodeRes = await findOwnNode(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
    oldRewardFoldDatum.currNode.next,
    nodeUTxOs,
  );

  if (ownNodeRes.type == "error") return ownNodeRes;
  const nodeInput = ownNodeRes.data;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const nodeDatum = Data.from(nodeInput.datum!, SetNode);
  const newFoldDatum = Data.to(
    {
      currNode: {
        key: oldRewardFoldDatum.currNode.key,
        next: nodeDatum.next,
        configTN: config.configTN,
      },
      totalRewardTokens: oldRewardFoldDatum.totalRewardTokens,
      totalStaked: oldRewardFoldDatum.totalStaked,
      owner: oldRewardFoldDatum.owner,
    },
    RewardFoldDatum,
  );

  const rewardToken = toUnit(config.rewardCS, fromText(config.rewardTN));
  const stakeToken = toUnit(config.stakeCS, fromText(config.stakeTN));
  const nodeStake = nodeInput.assets[stakeToken];

  const owedRewardTokenAmount =
    (nodeStake * oldRewardFoldDatum.totalRewardTokens) /
    oldRewardFoldDatum.totalStaked;

  const nodeOutputAssets = { ...nodeInput.assets };
  nodeOutputAssets["lovelace"] = MIN_ADA; // NODE_ADA - FOLDING_FEE

  // nodeOutputAssets[rewardToken] may not be undefined in case stake and reward tokens are one and the same
  nodeOutputAssets[rewardToken] =
    (nodeOutputAssets[rewardToken] || 0n) + owedRewardTokenAmount;

  const remainingRewardTokenAmount =
    rewardUTxO.data.assets[rewardToken] - owedRewardTokenAmount;

  config.currentTime ??= Date.now();
  const upperBound = config.currentTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currentTime - TIME_TOLERANCE_MS;

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  try {
    const tx = lucid
      .newTx()
      .collectFrom([nodeInput], Data.to("RewardFoldAct", NodeValidatorAction))
      .collectFrom([rewardUTxO.data], Data.to("RewardsFoldNode", RewardFoldAct))
      .withdraw(
        lucid.utils.validatorToRewardAddress(nodeStakeValidator),
        0n,
        Data.void(),
      )
      .payToContract(
        rewardFoldValidatorAddr,
        { inline: newFoldDatum },
        {
          ...rewardUTxO.data.assets,
          [stakeToken]: remainingRewardTokenAmount,
        },
      )
      .payToContract(
        nodeValidatorAddr,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        { inline: nodeInput.datum! },
        nodeOutputAssets,
      )
      .readFrom([
        config.refScripts.rewardFoldValidator,
        config.refScripts.nodeValidator,
        config.refScripts.nodeStakeValidator,
        configUTxOResponse.data,
      ])
      .validFrom(lowerBound)
      .validTo(upperBound);

    return {
      type: "ok",
      data: await tx.complete(),
    };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
