import {
  Lucid,
  SpendingValidator,
  MintingPolicy,
  TxHash,
} from "@anastasia-labs/lucid-cardano-fork";
import { setTimeout } from "timers/promises";
import { ProcessRewardsConfig, Result } from "../core/types.js";
import {
  COMMIT_FOLD_BATCH_SIZE,
  CampaignStatus,
  REWARD_FOLD_BATCH_SIZE,
  TIME_TOLERANCE_MS,
  catchErrorHandling,
  dinitNode,
  fetchCampaignState,
  fetchNodeUTxOs,
  findHeadNode,
  findRewardFoldUTxO,
  initFold,
  initRewardFold,
  multiFold,
  reclaimReward,
  rewardFoldNodes,
  signSubmitValidate,
} from "../index.js";
import * as lucidE from "@lucid-evolution/lucid";

export const processRewards = async (
  lucid: Lucid,
  lucid_evol: lucidE.LucidEvolution,
  config: ProcessRewardsConfig,
): Promise<Result<{ reclaimReward: TxHash; deinit: TxHash }>> => {
  const currentTime = Date.now();
  if (
    currentTime < config.endStaking ||
    config.endStaking > currentTime - TIME_TOLERANCE_MS
  )
    return {
      type: "error",
      error: new Error(
        currentTime < config.endStaking
          ? "Cannot starting processing rewards before endStaking time"
          : `Transaction validity range is overlapping staking phases. 
          Please wait for ${TIME_TOLERANCE_MS / 1_000} seconds before trying
          to process rewards.`,
      ),
    };

  const stateRes = await fetchCampaignState(lucid, config);
  if (stateRes.type == "error") return stateRes;

  let campaignStatus = stateRes.data.campaignStatus;

  // INIT FOLD

  if (campaignStatus == CampaignStatus.StakingEnded) {
    const initFoldUnsigned = await initFold(lucid, config);

    if (initFoldUnsigned.type == "error") {
      console.log(initFoldUnsigned.error);
      return initFoldUnsigned;
    }

    try {
      const initFoldSigned = await initFoldUnsigned.data.sign().complete();
      const initFoldHash = await initFoldSigned.submit();
      await lucid.awaitTx(initFoldHash);
      // offset wallet & blockchain sync
      await setTimeout(20_000);
      campaignStatus = CampaignStatus.StakeCalculationStarted;
    } catch (error) {
      return catchErrorHandling(
        error,
        "Error occured while submitting init fold tx.",
      );
    }
  }

  if (!config.nodeUTxOs) {
    const nodeUTxOs = await fetchNodeUTxOs(lucid, config);
    if (nodeUTxOs.type == "error") return nodeUTxOs;
    config.nodeUTxOs = nodeUTxOs.data;
  }

  console.log("number of nodes at nodeValidator: ", config.nodeUTxOs.length);

  // MULTIFOLD

  if (campaignStatus == CampaignStatus.StakeCalculationStarted) {
    const totalCommitFolds = Math.ceil(
      (config.nodeUTxOs.length - 1) / COMMIT_FOLD_BATCH_SIZE,
    );
    console.log(
      "time to complete commit fold (seconds): ",
      totalCommitFolds * 40,
    );

    let foldNumber = 1;
    const maxRetries = 3;

    while (foldNumber <= totalCommitFolds) {
      console.log(`processing commit fold number: ${foldNumber}`);

      let retries = 0;
      while (retries < maxRetries) {
        if (retries > 0) console.log(`retries : ${retries}`);

        const multiFoldUnsigned = await multiFold(lucid, config);

        // console.log(initNodeUnsigned.data.txComplete.to_json());
        const isValid = await signSubmitValidate(lucid, multiFoldUnsigned);
        if (isValid) break;
        retries++;
      }

      // offset wallet & blockchain sync
      await setTimeout(20_000);

      if (retries == 3) {
        const stateRes = await fetchCampaignState(lucid, config);
        // Break if retries were due to commit fold already being
        // completed earlier, in cases when fold was not started from the beginning
        if (
          stateRes.type == "ok" &&
          stateRes.data.campaignStatus == CampaignStatus.StakeCalculationEnded
        )
          break;

        return {
          type: "error",
          error: new Error("Error occurred while performing commit fold."),
        };
      }

      foldNumber++;
    }
    campaignStatus = CampaignStatus.StakeCalculationEnded;
  }

  // INIT REWARD FOLD

  if (campaignStatus == CampaignStatus.StakeCalculationEnded) {
    const initRewardFoldUnsigned = await initRewardFold(lucid, config);

    if (initRewardFoldUnsigned.type == "error") {
      console.log(initRewardFoldUnsigned.error);
      return initRewardFoldUnsigned;
    }

    try {
      const initRewardFoldSigned = await initRewardFoldUnsigned.data
        .sign()
        .complete();
      const initRewardFoldHash = await initRewardFoldSigned.submit();
      await lucid.awaitTx(initRewardFoldHash);
      await setTimeout(20_000);
      campaignStatus = CampaignStatus.RewardsProcessingStarted;
    } catch (error) {
      return catchErrorHandling(
        error,
        "Error occured while submitting init reward fold tx.",
      );
    }
  }

  // REWARD FOLDS

  if (campaignStatus == CampaignStatus.RewardsProcessingStarted) {
    const totalRewardFolds = Math.ceil(
      (config.nodeUTxOs.length - 1) / REWARD_FOLD_BATCH_SIZE,
    );
    console.log(
      "time to complete reward fold (seconds): ",
      totalRewardFolds * 40,
    );

    let foldNumber = 1;
    const maxRetries = 3;

    while (foldNumber <= totalRewardFolds) {
      console.log(`processing reward fold number: ${foldNumber}`);

      let retries = 0;
      while (retries < maxRetries) {
        if (retries > 0) console.log(`retries : ${retries}`);

        const rewardFoldUnsigned = await rewardFoldNodes(
          lucid,
          lucid_evol,
          config,
        );

        if (rewardFoldUnsigned.type == "error") return rewardFoldUnsigned;

        try {
          const rewardFoldSigned = await rewardFoldUnsigned.data.sign
            .withWallet()
            .complete();
          const rewardFoldHash = await rewardFoldSigned.submit();
          await lucid.awaitTx(rewardFoldHash);
          break;
        } catch (error) {
          console.log(error);
        }
        retries++;
      }

      // offset wallet & blockchain sync
      await setTimeout(20_000);

      if (retries == 3) {
        const stateRes = await fetchCampaignState(lucid, config);
        // Break if retries were due to reward fold already being
        // completed earlier, in cases when fold was not started from the beginning
        if (
          stateRes.type == "ok" &&
          stateRes.data.campaignStatus == CampaignStatus.UserClaimsAllowed
        )
          break;

        return {
          type: "error",
          error: new Error("Error occurred while performing reward fold."),
        };
      }

      foldNumber++;
    }
    campaignStatus = CampaignStatus.UserClaimsAllowed;
    // offset wallet & blockchain sync
    await setTimeout(20_000);
  }

  // RECLAIM REWARD & DEINIT

  if (
    !config.refScripts.rewardFoldValidator.scriptRef ||
    !config.refScripts.rewardFoldPolicy.scriptRef ||
    !config.refScripts.nodeValidator.scriptRef ||
    !config.refScripts.nodePolicy.scriptRef
  )
    return { type: "error", error: new Error("Missing Script Reference") };

  const rewardFoldValidator: SpendingValidator =
    config.refScripts.rewardFoldValidator.scriptRef;
  const rewardFoldValidatorAddr =
    lucid.utils.validatorToAddress(rewardFoldValidator);

  const rewardFoldPolicy: MintingPolicy =
    config.refScripts.rewardFoldPolicy.scriptRef;
  const rewardFoldPolicyId = lucid.utils.mintingPolicyToId(rewardFoldPolicy);

  const nodeValidator: SpendingValidator =
    config.refScripts.nodeValidator.scriptRef;
  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const nodePolicy: MintingPolicy = config.refScripts.nodePolicy.scriptRef;
  const nodePolicyId = lucid.utils.mintingPolicyToId(nodePolicy);

  const rewardUTxO = await findRewardFoldUTxO(
    lucid,
    config.configTN,
    rewardFoldValidatorAddr,
    rewardFoldPolicyId,
  );

  const headNodeUTxO = await findHeadNode(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
  );

  if (campaignStatus == CampaignStatus.UserClaimsAllowed) {
    let reclaimTxHash: TxHash = "";
    let deinitTxHash: TxHash = "";

    // If reward utxo is not found, assume reclaim reward to be done
    if (rewardUTxO.type == "ok") {
      const reclaimUnsigned = await reclaimReward(lucid, config);

      if (reclaimUnsigned.type == "error") return reclaimUnsigned;

      if (reclaimUnsigned.type == "ok") {
        try {
          const reclaimSigned = await reclaimUnsigned.data.sign().complete();
          reclaimTxHash = await reclaimSigned.submit();
          await lucid.awaitTx(reclaimTxHash);
        } catch (error) {
          return catchErrorHandling(
            error,
            "Error occured while submitting reclaim reward tx.",
          );
        }
      }
    }

    // If head node utxo is not found, assume deinit to be done
    if (headNodeUTxO.type == "ok") {
      const dinitNodeUnsigned = await dinitNode(lucid, config);

      if (dinitNodeUnsigned.type == "error") return dinitNodeUnsigned;

      if (dinitNodeUnsigned.type == "ok") {
        try {
          const dinitNodeSigned = await dinitNodeUnsigned.data
            .sign()
            .complete();
          deinitTxHash = await dinitNodeSigned.submit();
          await lucid.awaitTx(deinitTxHash);
        } catch (error) {
          return catchErrorHandling(
            error,
            "Error occured while submitting deinit tx.",
          );
        }
      }
    }

    if (reclaimTxHash || deinitTxHash)
      return {
        type: "ok",
        data: { reclaimReward: reclaimTxHash, deinit: deinitTxHash },
      };
  }

  return {
    type: "error",
    error: new Error("All processing actions are already completed"),
  };
};
