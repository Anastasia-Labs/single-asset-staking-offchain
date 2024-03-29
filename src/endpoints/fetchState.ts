import {
  Address,
  Data,
  Lucid,
  MintingPolicy,
  SpendingValidator,
  UTxO,
  fromText,
  toUnit,
} from "@anastasia-labs/lucid-cardano-fork";
import { FoldDatum, RewardFoldDatum, SetNode } from "../core/contract.types.js";
import {
  CampaignState,
  FetchCampaignStateConfig,
  FetchNodesConfig,
  FetchUserNodeConfig,
  ReadableUTxO,
  Result,
} from "../core/types.js";
import {
  CampaignStatus,
  MIN_ADA,
  calculateTotalStake,
  findFoldUTxO,
  findHeadNode,
  findOwnNode,
  findRewardFoldUTxO,
  findTokenHolderUTxO,
  mkNodeKeyTN,
  originNodeTokenName,
  parseSafeDatum,
} from "../index.js";

export const fetchCampaignState = async (
  lucid: Lucid,
  config: FetchCampaignStateConfig,
): Promise<Result<CampaignState>> => {
  config.currentTime ??= Date.now();

  if (
    !config.refScripts.nodeValidator.scriptRef ||
    !config.refScripts.nodePolicy.scriptRef ||
    !config.refScripts.rewardFoldPolicy.scriptRef ||
    !config.refScripts.rewardFoldValidator.scriptRef ||
    !config.refScripts.tokenHolderValidator.scriptRef ||
    !config.refScripts.tokenHolderPolicy.scriptRef ||
    !config.refScripts.foldValidator.scriptRef ||
    !config.refScripts.foldPolicy.scriptRef
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

  const tokenHolderValidator: SpendingValidator =
    config.refScripts.tokenHolderValidator.scriptRef;
  const tokenHolderValidatorAddr =
    lucid.utils.validatorToAddress(tokenHolderValidator);

  const tokenHolderPolicy: MintingPolicy =
    config.refScripts.tokenHolderPolicy.scriptRef;
  const tokenHolderPolicyId = lucid.utils.mintingPolicyToId(tokenHolderPolicy);

  const foldValidator: SpendingValidator =
    config.refScripts.foldValidator.scriptRef;
  const foldValidatorAddr = lucid.utils.validatorToAddress(foldValidator);

  const foldPolicy: MintingPolicy = config.refScripts.foldPolicy.scriptRef;
  const foldPolicyId = lucid.utils.mintingPolicyToId(foldPolicy);

  let totalReward;
  const rewardToken = toUnit(config.rewardCS, fromText(config.rewardTN));
  const stakeToken = toUnit(config.stakeCS, fromText(config.stakeTN));

  const tokenHolderUTxORes = await findTokenHolderUTxO(
    lucid,
    config.configTN,
    tokenHolderValidatorAddr,
    tokenHolderPolicyId,
  );
  if (tokenHolderUTxORes.type == "ok") {
    const tokenHolderUTxO = tokenHolderUTxORes.data;
    totalReward = Number(tokenHolderUTxO.assets[rewardToken]);
  }

  const totalStake = await calculateTotalStake(
    lucid,
    config.configTN,
    stakeToken,
    nodeValidatorAddr,
    nodePolicyId,
  );
  if (totalStake.type == "error") return totalStake;

  const campaignStateRes: Result<CampaignState> = {
    type: "ok",
    data: {
      campaignStatus: CampaignStatus.StakingNotStarted,
      totalStake: totalStake.data,
      totalReward: totalReward,
    },
  };

  const headNodeUTxORes = await findHeadNode(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
  );
  if (headNodeUTxORes.type == "error") {
    if (config.currentTime < config.freezeStake) return campaignStateRes;
    else if (config.currentTime > config.endStaking) {
      return checkRewardFoldState(
        lucid,
        config,
        campaignStateRes.data,
        rewardFoldValidatorAddr,
        rewardFoldPolicyId,
      );
    } else return headNodeUTxORes;
  }

  if (config.currentTime < config.freezeStake) {
    campaignStateRes.data.campaignStatus = CampaignStatus.StakingOpen;
    return campaignStateRes;
  } else if (
    config.currentTime >= config.freezeStake &&
    config.currentTime <= config.endStaking
  ) {
    campaignStateRes.data.campaignStatus = CampaignStatus.StakeFrozen;
    return campaignStateRes;
  } else {
    // todo using errors in finding utxo as them not being present.
    // Change this behavior to not mistaken other errors as utxo not being present.
    const foldUTxO = await findFoldUTxO(
      lucid,
      config.configTN,
      foldValidatorAddr,
      foldPolicyId,
    );
    if (foldUTxO.type == "error") {
      return checkRewardFoldState(
        lucid,
        config,
        campaignStateRes.data,
        rewardFoldValidatorAddr,
        rewardFoldPolicyId,
        headNodeUTxORes.data,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const foldDatum = Data.from(foldUTxO.data.datum!, FoldDatum);
    if (foldDatum.currNode.next) {
      campaignStateRes.data.campaignStatus =
        CampaignStatus.StakeCalculationStarted;
      return campaignStateRes;
    } else {
      campaignStateRes.data.campaignStatus =
        CampaignStatus.StakeCalculationEnded;
      campaignStateRes.data.totalStake = Number(foldDatum.staked);
      return campaignStateRes;
    }
  }
};

export const checkRewardFoldState = async (
  lucid: Lucid,
  config: FetchCampaignStateConfig,
  campaignState: CampaignState,
  rewardFoldValidatorAddr: Address,
  rewardFoldPolicyId: string,
  headNode?: UTxO,
): Promise<Result<CampaignState>> => {
  const campaignStateRes: Result<CampaignState> = {
    type: "ok",
    data: campaignState,
  };

  const rfoldUTxO = await findRewardFoldUTxO(
    lucid,
    config.configTN,
    rewardFoldValidatorAddr,
    rewardFoldPolicyId,
  );
  if (rfoldUTxO.type == "error") {
    if (headNode) {
      if (headNode.assets["lovelace"] == MIN_ADA) {
        campaignStateRes.data.campaignStatus = CampaignStatus.UserClaimsAllowed;
        if (
          toUnit(config.stakeCS, fromText(config.stakeTN)) ==
          toUnit(config.rewardCS, fromText(config.rewardTN))
        )
          campaignStateRes.data.totalStake = undefined;

        return campaignStateRes;
      } else {
        campaignStateRes.data.campaignStatus = CampaignStatus.StakingEnded;
        return campaignStateRes;
      }
    } else {
      // TODO improve this check as it has weak guarantees of confirming that
      // reward fold concluded, head deinit and reward reclaimed.
      campaignStateRes.data.campaignStatus = CampaignStatus.UserClaimsAllowed;
      return campaignStateRes;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const rFoldDatum = Data.from(rfoldUTxO.data.datum!, RewardFoldDatum);
  campaignStateRes.data.totalStake = Number(rFoldDatum.totalStaked);
  campaignStateRes.data.totalReward = Number(rFoldDatum.totalRewardTokens);

  if (rFoldDatum.currNode.next) {
    campaignStateRes.data.campaignStatus =
      CampaignStatus.RewardsProcessingStarted;
    return campaignStateRes;
  } else {
    campaignStateRes.data.campaignStatus = CampaignStatus.UserClaimsAllowed;
    return campaignStateRes;
  }
};

export const fetchUserNode = async (
  lucid: Lucid,
  config: FetchUserNodeConfig,
): Promise<Result<ReadableUTxO<SetNode>>> => {
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

  try {
    const userKey = lucid.utils.getAddressDetails(
      config.userAddress,
    ).paymentCredential;

    if (!userKey)
      return {
        type: "error",
        error: new Error("missing payment credential in user address"),
      };

    const utxo = await findOwnNode(
      lucid,
      config.configTN,
      nodeValidatorAddr,
      nodePolicyId,
      userKey.hash,
    );

    if (utxo.type == "error") return utxo;

    return {
      type: "ok",
      data: {
        outRef: {
          txHash: utxo.data.txHash,
          outputIndex: utxo.data.outputIndex,
        },
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        datum: Data.from(utxo.data.datum!, SetNode),
        assets: utxo.data.assets,
      },
    };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

export const fetchReadableNodeUTxOs = async (
  lucid: Lucid,
  config: FetchNodesConfig,
): Promise<Result<ReadableUTxO<SetNode>[]>> => {
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

  try {
    const utxos = await lucid.utxosAt(nodeValidatorAddr);
    const nodeUTxOs: ReadableUTxO<SetNode>[] = [];

    utxos.forEach((value) => {
      const datumRes = parseSafeDatum(value.datum, SetNode);

      if (datumRes.type == "right") {
        const datum = datumRes.value;

        if (
          datum.configTN == config.configTN &&
          value.assets[
            toUnit(
              nodePolicyId,
              datum.key ? mkNodeKeyTN(datum.key) : originNodeTokenName,
            )
          ] == BigInt(1)
        ) {
          nodeUTxOs.push({
            outRef: {
              txHash: value.txHash,
              outputIndex: value.outputIndex,
            },
            datum: datum,
            assets: value.assets,
          });
        }
      }
    });

    return { type: "ok", data: nodeUTxOs };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

export const fetchNodeUTxOs = async (
  lucid: Lucid,
  config: FetchNodesConfig,
): Promise<Result<UTxO[]>> => {
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

  try {
    const utxos = await lucid.utxosAt(nodeValidatorAddr);
    const nodeUTxOs: UTxO[] = [];

    utxos.forEach((value) => {
      const datumRes = parseSafeDatum(value.datum, SetNode);
      if (datumRes.type == "right") {
        const datum = datumRes.value;

        if (
          datum.configTN == config.configTN &&
          value.assets[
            toUnit(
              nodePolicyId,
              datum.key ? mkNodeKeyTN(datum.key) : originNodeTokenName,
            )
          ] == BigInt(1)
        )
          nodeUTxOs.push(value);
      }
    });

    return { type: "ok", data: nodeUTxOs };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
