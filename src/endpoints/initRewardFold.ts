import {
  Lucid,
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  TxComplete,
  Constr,
  fromText,
  WithdrawalValidator,
} from "@anastasia-labs/lucid-cardano-fork";
import { cFold, MIN_ADA, rFold, RTHOLDER } from "../core/constants.js";
import {
  SetNode,
  FoldDatum,
  RewardFoldDatum,
  NodeValidatorAction,
  RewardFoldMintAct,
} from "../core/contract.types.js";
import { InitRewardFoldConfig, Result } from "../core/types.js";
import {
  findFoldUTxO,
  findHeadNode,
  findTokenHolderUTxO,
  fromAddress,
} from "../index.js";
import { fetchConfigUTxO } from "./fetchConfig.js";

export const initRewardFold = async (
  lucid: Lucid,
  config: InitRewardFoldConfig,
): Promise<Result<TxComplete>> => {
  if (
    !config.refScripts.nodeValidator.scriptRef ||
    !config.refScripts.nodePolicy.scriptRef ||
    !config.refScripts.nodeStakeValidator.scriptRef ||
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

  const nodeStakeValidator: WithdrawalValidator =
    config.refScripts.nodeStakeValidator.scriptRef;

  const tokenHolderValidator: SpendingValidator =
    config.refScripts.tokenHolderValidator.scriptRef;
  const tokenHolderValidatorAddr =
    lucid.utils.validatorToAddress(tokenHolderValidator);

  const tokenHolderPolicy: MintingPolicy =
    config.refScripts.tokenHolderPolicy.scriptRef;
  const tokenHolderPolicyId = lucid.utils.mintingPolicyToId(tokenHolderPolicy);

  const foldValidator: SpendingValidator =
    config.refScripts.foldValidator.scriptRef;
  const commitFoldValidatorAddr = lucid.utils.validatorToAddress(foldValidator);

  const foldPolicy: MintingPolicy = config.refScripts.foldPolicy.scriptRef;
  const commitFoldPolicyId = lucid.utils.mintingPolicyToId(foldPolicy);

  const headNodeUTxORes = await findHeadNode(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
  );
  if (headNodeUTxORes.type == "error") return headNodeUTxORes;
  const headNodeUTxO = headNodeUTxORes.data;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const headNodeDatum = Data.from(headNodeUTxO.datum!, SetNode);

  const rtHolderUnit = toUnit(tokenHolderPolicyId, fromText(RTHOLDER));

  const tokenHolderUTxORes = await findTokenHolderUTxO(
    lucid,
    config.configTN,
    tokenHolderValidatorAddr,
    tokenHolderPolicyId,
  );
  if (tokenHolderUTxORes.type == "error") return tokenHolderUTxORes;
  const tokenHolderUTxO = tokenHolderUTxORes.data;

  const commitFoldUnit = toUnit(commitFoldPolicyId, cFold);

  const commitFoldUTxORes = await findFoldUTxO(
    lucid,
    config.configTN,
    commitFoldValidatorAddr,
    commitFoldPolicyId,
  );
  if (commitFoldUTxORes.type == "error") return commitFoldUTxORes;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const commitFoldDatum = Data.from(commitFoldUTxORes.data.datum!, FoldDatum);
  if (commitFoldDatum.currNode.next)
    return {
      type: "error",
      error: new Error(
        "Cannot Init Reward Fold as Commit Fold is not completed.",
      ),
    };

  const rewardUnit = toUnit(config.rewardCS, fromText(config.rewardTN));

  const datum = Data.to(
    {
      currNode: headNodeDatum,
      totalRewardTokens: tokenHolderUTxO.assets[rewardUnit],
      totalStaked: commitFoldDatum.staked,
      owner: fromAddress(await lucid.wallet.address()),
    },
    RewardFoldDatum,
  );

  const burnRTHolderAct = Data.to(new Constr(1, []));
  const burnCommitFoldAct = Data.to(new Constr(1, []));
  const reclaimCommitFoldAct = Data.to(new Constr(1, []));

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  try {
    const tx = await lucid
      .newTx()
      .collectFrom(
        [headNodeUTxO],
        Data.to("RewardFoldAct", NodeValidatorAction),
      )
      .collectFrom([tokenHolderUTxO], Data.void())
      .collectFrom([commitFoldUTxORes.data], reclaimCommitFoldAct)
      .payToContract(
        rewardFoldValidatorAddr,
        { inline: datum },
        {
          [toUnit(rewardFoldPolicyId, rFold)]: 1n,
          [rewardUnit]: tokenHolderUTxO.assets[rewardUnit],
        },
      )
      .payToContract(
        nodeValidatorAddr,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        { inline: headNodeUTxO.datum! },
        { ...headNodeUTxO.assets, lovelace: MIN_ADA }, // Taking FOLDING_FEE to indicate rewards fold init. NODE_ADA - FOLDING_FEE == MIN_ADA
      )
      .mintAssets(
        { [toUnit(rewardFoldPolicyId, rFold)]: 1n },
        Data.to("MintRewardFold", RewardFoldMintAct),
      )
      .mintAssets({ [commitFoldUnit]: -1n }, burnCommitFoldAct)
      .mintAssets({ [rtHolderUnit]: -1n }, burnRTHolderAct)
      .withdraw(
        lucid.utils.validatorToRewardAddress(nodeStakeValidator),
        0n,
        Data.void(),
      )
      .readFrom([
        config.refScripts.tokenHolderValidator,
        config.refScripts.tokenHolderPolicy,
        config.refScripts.nodeValidator,
        config.refScripts.nodeStakeValidator,
        config.refScripts.foldValidator,
        config.refScripts.foldPolicy,
        config.refScripts.rewardFoldPolicy,
        configUTxOResponse.data,
      ])
      .addSigner(await lucid.wallet.address())
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
