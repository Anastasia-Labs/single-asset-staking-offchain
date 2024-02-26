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
import { Result, RewardFoldNodesConfig } from "../core/types.js";
import {
  MIN_ADA,
  TIME_TOLERANCE_MS,
  getInputUtxoIndices,
  rFold,
  selectUtxos,
  sumUtxoAssets,
} from "../index.js";
import { fetchConfigUTxO } from "./fetchConfig.js";

export const rewardFoldNodes = async (
  lucid: Lucid,
  config: RewardFoldNodesConfig,
): Promise<Result<TxComplete>> => {
  if (!config.refScripts.nodeValidator.scriptRef)
    return { type: "error", error: new Error("Missing Script Reference") };
  const nodeValidator: SpendingValidator =
    config.refScripts.nodeValidator.scriptRef;
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

  const nodeStakeValidator: WithdrawalValidator = {
    type: "PlutusV2",
    script: config.scripts.nodeStakeValidator,
  };

  const [rewardUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress(rewardFoldValidator),
    toUnit(rewardFoldPolicyId, rFold),
  );
  if (!rewardUTxO.datum)
    return { type: "error", error: new Error("missing RewardFoldDatum") };

  const oldRewardFoldDatum = Data.from(rewardUTxO.datum, RewardFoldDatum);

  if (oldRewardFoldDatum.currNode.next == null)
    return {
      type: "error",
      error: new Error("Rewards fold already completed"),
    };

  //NOTE: nodeInputs should be already ordered by keys
  const nodeUTxOs = await lucid.utxosByOutRef(config.nodeInputs);

  if (!nodeUTxOs.length)
    return { type: "error", error: new Error("No node UTxOs found") };

  if (!nodeUTxOs[0].datum)
    return {
      type: "error",
      error: new Error("missing datum for first node input"),
    };

  const firstNodeDatum = Data.from(nodeUTxOs[0].datum, SetNode);
  if (firstNodeDatum.key !== oldRewardFoldDatum.currNode.next)
    return {
      type: "error",
      error: new Error("First input node is not next in line for rewards fold"),
    };

  const lastNode = nodeUTxOs[nodeUTxOs.length - 1].datum;
  if (!lastNode)
    return {
      type: "error",
      error: new Error("missing datum for last node input"),
    };
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
    RewardFoldDatum,
  );

  const walletAddress = await lucid.wallet.address();
  const walletUTxOs = await lucid.wallet.getUtxos();
  // adding 4 ADA to cover tx fees as we will do the coin selection.
  // Using more than sufficient ADA to safeguard against high tx costs
  const selectedUtxos = selectUtxos(walletUTxOs, { lovelace: 4_000_000n });
  if (selectedUtxos.type == "error") return selectedUtxos;
  const inputIndices = getInputUtxoIndices(nodeUTxOs, [
    ...selectedUtxos.data,
    rewardUTxO,
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
    let tx = lucid
      .newTx()
      .collectFrom(nodeUTxOs, Data.to("RewardFoldAct", NodeValidatorAction));

    nodeUTxOs.forEach((utxo, index) => {
      const owedRewardTokenAmount =
        (utxo.assets[stakeToken] * oldRewardFoldDatum.totalRewardTokens) /
        oldRewardFoldDatum.totalStaked;

      const nodeOutputAssets = { ...utxo.assets };
      nodeOutputAssets["lovelace"] = MIN_ADA; // NODE_ADA - FOLDING_FEE

      // nodeOutputAssets[rewardToken] may not be undefined in case stake and reward tokens are one and the same
      nodeOutputAssets[rewardToken] =
        (nodeOutputAssets[rewardToken] || 0n) + owedRewardTokenAmount;
      totalOwedReward += owedRewardTokenAmount;

      if (!utxo.datum)
        return {
          type: "error",
          error: new Error("No datum found for node input"),
        };

      tx = tx.payToContract(
        nodeValidatorAddr,
        { inline: utxo.datum },
        nodeOutputAssets,
      );

      nodeOutIdxs.push(BigInt(index));
    });

    const remainingRewardTokenAmount =
      rewardUTxO.assets[rewardToken] - totalOwedReward;
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
      .collectFrom([rewardUTxO], rewardFoldValidatorRedeemer)
      .collectFrom(selectedUtxos.data)
      .payToContract(
        rewardFoldValidatorAddr,
        { inline: newFoldDatum },
        {
          ...rewardUTxO.assets,
          [stakeToken]: remainingRewardTokenAmount,
        },
      )
      .withdraw(
        lucid.utils.validatorToRewardAddress(nodeStakeValidator),
        0n,
        Data.void(),
      )
      .compose(
        // Return and balance native tokens (if any) obtained from spending wallet UTxOs
        Object.keys(walletAssets).length > 0
          ? lucid.newTx().payToAddress(walletAddress, walletAssets)
          : null,
      )
      .compose(
        config.refScripts?.rewardFoldValidator
          ? lucid.newTx().readFrom([config.refScripts.rewardFoldValidator])
          : lucid.newTx().attachSpendingValidator(rewardFoldValidator),
      )
      .compose(
        config.refScripts?.nodeValidator
          ? lucid.newTx().readFrom([config.refScripts.nodeValidator])
          : lucid.newTx().attachSpendingValidator(nodeValidator),
      )
      .compose(
        config.refScripts?.nodeStakeValidator
          ? lucid.newTx().readFrom([config.refScripts.nodeStakeValidator])
          : lucid.newTx().attachWithdrawalValidator(nodeStakeValidator),
      )
      .validFrom(lowerBound)
      .validTo(upperBound);

    return {
      type: "ok",
      data: await (process.env.NODE_ENV == "emulator"
        ? tx.complete()
        : tx.complete({ nativeUplc: false })),
    };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
