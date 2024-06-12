import {
  Lucid,
  SpendingValidator,
  Data,
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
import { Result, RewardFoldNodesConfig } from "../core/types.js";
import {
  REWARD_FOLD_BATCH_SIZE,
  TIME_TOLERANCE_MS,
  findConsecutiveNodes,
  findRewardFoldUTxO,
  getInputUtxoIndices,
  selectUtxos,
  sumUtxoAssets,
} from "../index.js";
import { fetchConfigUTxO } from "./fetchConfig.js";
import * as lucidE from "@lucid-evolution/lucid";

export const rewardFoldNodes = async (
  lucid: Lucid,
  lucid_evol: lucidE.LucidEvolution,
  config: RewardFoldNodesConfig,
): Promise<Result<lucidE.TxSignBuilder>> => {
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

  // NOTE: nodeInputs should be ordered by keys
  const nodeInputsResponse = await findConsecutiveNodes(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
    oldRewardFoldDatum.currNode.next,
    REWARD_FOLD_BATCH_SIZE,
    config.nodeUTxOs,
  );
  if (nodeInputsResponse.type == "error") return nodeInputsResponse;
  const nodeInputs = nodeInputsResponse.data;

  const lastNode = nodeInputs[nodeInputs.length - 1].datum;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const lastNodeDatum = Data.from(lastNode!, SetNode);

  const newFoldDatum = Data.to(
    {
      currNode: {
        key: oldRewardFoldDatum.currNode.key,
        next: lastNodeDatum.next,
        configTN: config.configTN,
      },
      totalRewardTokens: oldRewardFoldDatum.totalRewardTokens,
      totalStaked: oldRewardFoldDatum.totalStaked,
      owner: oldRewardFoldDatum.owner,
    },
    RewardFoldDatum,
  );

  const walletUTxOs = await lucid.wallet.getUtxos();
  // adding 4 ADA to cover tx fees as we will do the coin selection.
  // Using more than sufficient ADA to safeguard against high tx costs
  const selectedUtxos = selectUtxos(walletUTxOs, { lovelace: 4_000_000n });
  if (selectedUtxos.type == "error") return selectedUtxos;
  const inputIndices = getInputUtxoIndices(nodeInputs, [
    ...selectedUtxos.data,
    rewardUTxO.data,
  ]);

  // balance the native assets from wallet inputs
  const walletAssets = sumUtxoAssets(selectedUtxos.data);
  delete walletAssets["lovelace"]; // we would want lucid to balance ADA for the tx

  const rewardToken = toUnit(config.rewardCS, fromText(config.rewardTN));
  const stakeToken = toUnit(config.stakeCS, fromText(config.stakeTN));
  const nodeOutIdxs: bigint[] = [];
  let totalOwedReward = 0n;

  config.currentTime ??= Date.now();
  const upperBound = config.currentTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currentTime - TIME_TOLERANCE_MS;

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  try {
    let tx = lucid_evol
      .newTx()
      .collectFrom(nodeInputs, Data.to("RewardFoldAct", NodeValidatorAction));

    nodeInputs.forEach((utxo, index) => {
      const owedRewardTokenAmount =
        (utxo.assets[stakeToken] * oldRewardFoldDatum.totalRewardTokens) /
        oldRewardFoldDatum.totalStaked;

      const nodeOutputAssets = { ...utxo.assets };
      // Let lucid set min ADA
      delete nodeOutputAssets["lovelace"];

      // nodeOutputAssets[rewardToken] may not be undefined in case stake and reward tokens are one and the same
      nodeOutputAssets[rewardToken] =
        (nodeOutputAssets[rewardToken] || 0n) + owedRewardTokenAmount;
      totalOwedReward += owedRewardTokenAmount;

      if (!utxo.datum)
        return {
          type: "error",
          error: new Error("No datum found for node input"),
        };

      tx = tx.pay.ToContract(
        nodeValidatorAddr,
        { kind: "inline", value: utxo.datum },
        nodeOutputAssets,
      );

      nodeOutIdxs.push(BigInt(index));
    });

    const remainingRewardTokenAmount =
      rewardUTxO.data.assets[rewardToken] - totalOwedReward;
    const updatedRewardUTxOAssets = {
      ...rewardUTxO.data.assets,
      [rewardToken]: remainingRewardTokenAmount,
    };
    if (remainingRewardTokenAmount == BigInt(0))
      delete updatedRewardUTxOAssets[rewardToken];
    const rewardFoldValidatorRedeemer = Data.to(
      {
        RewardsFoldNodes: {
          nodeIdxs: inputIndices,
          nodeOutIdxs: nodeOutIdxs,
        },
      },
      RewardFoldAct,
    );

    tx = tx
      .collectFrom([rewardUTxO.data], rewardFoldValidatorRedeemer)
      .collectFrom(selectedUtxos.data)
      .pay.ToContract(
        rewardFoldValidatorAddr,
        { kind: "inline", value: newFoldDatum },
        updatedRewardUTxOAssets,
      )
      .withdraw(
        lucid.utils.validatorToRewardAddress(nodeStakeValidator),
        0n,
        Data.void(),
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
