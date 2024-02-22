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
import { cFold, MIN_ADA, originNodeTokenName, rFold, RTHOLDER } from "../core/constants.js";
import { SetNode, FoldDatum, RewardFoldDatum, NodeValidatorAction, RewardFoldMintAct } from "../core/contract.types.js";
import { InitRewardFoldConfig, Result } from "../core/types.js";
import { fromAddress } from "../index.js";

export const initRewardFold = async (
  lucid: Lucid,
  config: InitRewardFoldConfig
): Promise<Result<TxComplete>> => {
  const tokenHolderValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.tokenHolderValidator,
  };

  const tokenHolderPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: config.scripts.tokenHolderPolicy,
  };
  const tokenHolderPolicyId = lucid.utils.mintingPolicyToId(tokenHolderPolicy);

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

  const foldValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.foldValidator,
  };
  const commitFoldValidatorAddr =
    lucid.utils.validatorToAddress(foldValidator);

  const foldPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: config.scripts.foldPolicy,
  };
  const commitFoldPolicyId = lucid.utils.mintingPolicyToId(foldPolicy);

  const nodePolicy: MintingPolicy = {
    type: "PlutusV2",
    script: config.scripts.nodePolicy,
  };

  const nodeValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.nodeValidator,
  };

  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const nodeStakeValidator: WithdrawalValidator = {
    type: "PlutusV2",
    script: config.scripts.nodeStakeValidator,
  };

  const [headNodeUTxO] = await lucid.utxosAtWithUnit(
    nodeValidatorAddr,
    toUnit(
      lucid.utils.mintingPolicyToId(nodePolicy),
      originNodeTokenName
    )
  );

  if (!headNodeUTxO || !headNodeUTxO.datum)
    return { type: "error", error: new Error("missing nodeRefInputUTxO") };

  const headNodeDatum = Data.from(headNodeUTxO.datum, SetNode);

  const rtHolderUnit = toUnit(tokenHolderPolicyId, fromText(RTHOLDER));

  const tokenHolderUTxO = await lucid.utxoByUnit(rtHolderUnit);

  const commitFoldUnit = toUnit(commitFoldPolicyId, cFold);
  const commitFoldUTxO = (
    await lucid.utxosAtWithUnit(commitFoldValidatorAddr, commitFoldUnit)
  ).find((value) => {
    if (value.datum) {
      const datum = Data.from(value.datum, FoldDatum);
      return datum.currNode.next == null;
    }
  });

  if (!commitFoldUTxO || !commitFoldUTxO.datum)
    return { type: "error", error: new Error("missing commitFoldUTxO") };

  const commitFoldDatum = Data.from(commitFoldUTxO.datum, FoldDatum);

  const rewardUnit = toUnit(config.rewardCS, fromText(config.rewardTN));

  const datum = Data.to(
    {
      currNode: headNodeDatum,
      totalRewardTokens: tokenHolderUTxO.assets[rewardUnit],
      totalStaked: commitFoldDatum.staked,
      owner: fromAddress(await lucid.wallet.address()),
    },
    RewardFoldDatum
  );

  const burnRTHolderAct = Data.to(new Constr(1, []));
  const burnCommitFoldAct = Data.to(new Constr(1, []));
  const reclaimCommitFoldAct = Data.to(new Constr(1, []));

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([headNodeUTxO], Data.to("RewardFoldAct", NodeValidatorAction))
      .collectFrom([tokenHolderUTxO], Data.void())
      .collectFrom([commitFoldUTxO], reclaimCommitFoldAct)
      .payToContract(
        rewardFoldValidatorAddr,
        { inline: datum },
        {
          [toUnit(rewardFoldPolicyId, rFold)]: 1n,
          [rewardUnit]: tokenHolderUTxO.assets[rewardUnit],
        }
      )
      .payToContract(
        nodeValidatorAddr,
        { inline: headNodeUTxO.datum },
        { ...headNodeUTxO.assets, lovelace: MIN_ADA } // Taking FOLDING_FEE to indicate rewards fold init. NODE_ADA - FOLDING_FEE == MIN_ADA
      )
      .mintAssets(
        { [toUnit(rewardFoldPolicyId, rFold)]: 1n },
        Data.to("MintRewardFold", RewardFoldMintAct)
      )
      .mintAssets({ [commitFoldUnit]: -1n }, burnCommitFoldAct)
      .mintAssets({ [rtHolderUnit]: -1n }, burnRTHolderAct)
      .withdraw(
        lucid.utils.validatorToRewardAddress(nodeStakeValidator),
        0n,
        Data.void()
      )
      .compose(
        config.refScripts?.tokenHolderValidator
          ? lucid.newTx().readFrom([config.refScripts.tokenHolderValidator])
          : lucid.newTx().attachSpendingValidator(tokenHolderValidator)
      )
      .compose(
        config.refScripts?.foldValidator
          ? lucid.newTx().readFrom([config.refScripts.foldValidator])
          : lucid.newTx().attachSpendingValidator(foldValidator)
      )
      .compose(
        config.refScripts?.rewardFoldPolicy
          ? lucid.newTx().readFrom([config.refScripts.rewardFoldPolicy])
          : lucid.newTx().attachMintingPolicy(rewardFoldPolicy)
      )
      .compose(
        config.refScripts?.foldPolicy
          ? lucid.newTx().readFrom([config.refScripts.foldPolicy])
          : lucid.newTx().attachMintingPolicy(foldPolicy)
      )
      .compose(
        config.refScripts?.tokenHolderPolicy
          ? lucid.newTx().readFrom([config.refScripts.tokenHolderPolicy])
          : lucid.newTx().attachMintingPolicy(tokenHolderPolicy)
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
      .addSigner(await lucid.wallet.address())
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
