import {
  SpendingValidator,
  MintingPolicy,
  TxHash,
  LucidEvolution,
  validatorToAddress,
  mintingPolicyToId,
} from "@lucid-evolution/lucid";
import { setTimeout } from "timers/promises";
import { ProcessRewardsConfig, Result } from "../core/types.js";
import {
  COMMIT_FOLD_BATCH_SIZE,
  CampaignStatus,
  REWARD_FOLD_BATCH_SIZE,
  TIME_TOLERANCE_MS,
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
  lucid: LucidEvolution,
  lucid_evol: lucidE.LucidEvolution,
  config: ProcessRewardsConfig,
): Promise<Result<{ reclaimReward: TxHash; deinit: TxHash }>> => {
  const network = lucid.config().network;
  const currentTime = Date.now();
  if (
    currentTime < config.endStaking ||
    config.endStaking > currentTime - TIME_TOLERANCE_MS
  )
    return {
      type: "error",
      error: new Error(
        currentTime < config.endStaking
          ? "Cannot start processing rewards before endStaking time"
          : `Transaction validity range is overlapping staking phases. 
          Please wait for ${TIME_TOLERANCE_MS / 1_000} seconds before trying
          to process rewards.`,
      ),
    };

  const stateRes = await fetchCampaignState(lucid, config);
  if (stateRes.type == "error") return stateRes;

  let campaignStatus = stateRes.data.campaignStatus;
  const maxRetries = 3;

  // INIT FOLD

  if (campaignStatus == CampaignStatus.StakingEnded) {
    let retries = 0;
    while (retries < maxRetries) {
      // Unsetting current time so that endpoints can set it more accurately
      config.currentTime = undefined;
      if (retries > 0) console.log(`initFold retries : ${retries}`);

      const initFoldUnsigned = await initFold(lucid, config);
      const response = await signSubmitValidate(lucid, initFoldUnsigned);

      if (response.type == "ok") break;
      if (retries == 2) return response;
      retries++;
      await setTimeout(20_000);
    }

    await setTimeout(20_000);
    campaignStatus = CampaignStatus.StakeCalculationStarted;
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

    while (foldNumber <= totalCommitFolds) {
      console.log(`processing commit fold number: ${foldNumber}`);

      let retries = 0;
      while (retries < maxRetries) {
        // Unsetting current time so that endpoints can set it more accurately
        config.currentTime = undefined;
        if (retries > 0) console.log(`multiFold retries : ${retries}`);

        const multiFoldUnsigned = await multiFold(lucid, config);
        const response = await signSubmitValidate(lucid, multiFoldUnsigned);

        if (response.type == "ok") break;
        retries++;
        await setTimeout(20_000);
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
    let retries = 0;
    while (retries < maxRetries) {
      // Unsetting current time so that endpoints can set it more accurately
      config.currentTime = undefined;
      if (retries > 0) console.log(`initRewardFold retries : ${retries}`);

      const initRewardFoldUnsigned = await initRewardFold(lucid, config);
      const response = await signSubmitValidate(lucid, initRewardFoldUnsigned);

      if (response.type == "ok") break;
      if (retries == 2) return response;
      retries++;
      await setTimeout(20_000);
    }

    await setTimeout(20_000);
    campaignStatus = CampaignStatus.RewardsProcessingStarted;
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
    let errorResponse: Result<object> = {
      type: "error",
      error: new Error("Error occurred while performing reward fold."),
    };

    while (foldNumber <= totalRewardFolds) {
      console.log(`processing reward fold number: ${foldNumber}`);

      let retries = 0;
      while (retries < maxRetries) {
        // Unsetting current time so that endpoints can set it more accurately
        config.currentTime = undefined;
        if (retries > 0) console.log(`rewardFoldNodes retries : ${retries}`);

        try {
          const rewardFoldUnsigned = await rewardFoldNodes(
            lucid,
            lucid_evol,
            config,
          );
          if (rewardFoldUnsigned.type == "error") {
            errorResponse = rewardFoldUnsigned;
            retries++;
            await setTimeout(20_000);
            continue;
          }

          const rewardFoldSigned = await rewardFoldUnsigned.data.sign
            .withWallet()
            .complete();
          const rewardFoldHash = await rewardFoldSigned.submit();
          await lucid.awaitTx(rewardFoldHash);
          break;
        } catch (error) {
          errorResponse.error =
            error instanceof Error
              ? error
              : new Error(`${JSON.stringify(error)}`);
        }
        retries++;
        await setTimeout(20_000);
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

        return errorResponse;
      }

      foldNumber++;
    }
    campaignStatus = CampaignStatus.UserClaimsAllowed;
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
    validatorToAddress(network,rewardFoldValidator);

  const rewardFoldPolicy: MintingPolicy =
    config.refScripts.rewardFoldPolicy.scriptRef;
  const rewardFoldPolicyId = mintingPolicyToId(rewardFoldPolicy);

  const nodeValidator: SpendingValidator =
    config.refScripts.nodeValidator.scriptRef;
  const nodeValidatorAddr = validatorToAddress(network,nodeValidator);

  const nodePolicy: MintingPolicy = config.refScripts.nodePolicy.scriptRef;
  const nodePolicyId = mintingPolicyToId(nodePolicy);

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
      let retries = 0;
      while (retries < maxRetries) {
        // Unsetting current time so that endpoints can set it more accurately
        config.currentTime = undefined;
        if (retries > 0) console.log(`reclaimReward retries : ${retries}`);

        const reclaimUnsigned = await reclaimReward(lucid, config);
        const response = await signSubmitValidate(lucid, reclaimUnsigned);

        if (response.type == "ok") {
          reclaimTxHash = response.data;
          break;
        }
        if (retries == 2) return response;
        retries++;
        await setTimeout(20_000);
      }
      // offset wallet & blockchain sync
      await setTimeout(20_000);
    }

    // If head node utxo is not found, assume deinit to be done
    if (headNodeUTxO.type == "ok") {
      let retries = 0;
      while (retries < maxRetries) {
        // Unsetting current time so that endpoints can set it more accurately
        config.currentTime = undefined;
        if (retries > 0) console.log(`dinitNode retries : ${retries}`);

        const dinitNodeUnsigned = await dinitNode(lucid, config);
        const response = await signSubmitValidate(lucid, dinitNodeUnsigned);

        if (response.type == "ok") {
          deinitTxHash = response.data;
          break;
        }
        if (retries == 2) return response;
        retries++;
        await setTimeout(20_000);
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
