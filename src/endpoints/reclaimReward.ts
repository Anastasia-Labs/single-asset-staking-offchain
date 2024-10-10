import {
  SpendingValidator,
  Data,
  MintingPolicy,
  toUnit,
  fromText,
  LucidEvolution,
  mintingPolicyToId,
  validatorToAddress,
  getAddressDetails,
  TxSignBuilder
} from "@lucid-evolution/lucid";
import {
  RewardFoldDatum,
  RewardFoldAct,
  RewardFoldMintAct,
} from "../core/contract.types.js";
import { InitRewardFoldConfig, Result } from "../core/types.js";
import { findRewardFoldUTxO, rFold } from "../index.js";
import { fetchConfigUTxO } from "./fetchConfig.js";

export const reclaimReward = async (
  lucid: LucidEvolution,
  config: InitRewardFoldConfig,
): Promise<Result<TxSignBuilder>> => {
  const network = lucid.config().network;

  if (
    !config.refScripts.rewardFoldValidator.scriptRef ||
    !config.refScripts.rewardFoldPolicy.scriptRef
  )
    return { type: "error", error: new Error("Missing Script Reference") };

  const rewardFoldValidator: SpendingValidator =
    config.refScripts.rewardFoldValidator.scriptRef;
  const rewardFoldValidatorAddr =
    validatorToAddress(network,rewardFoldValidator);

  const rewardFoldPolicy: MintingPolicy =
    config.refScripts.rewardFoldPolicy.scriptRef;
  const rewardFoldPolicyId = mintingPolicyToId(rewardFoldPolicy);

  const rewardUTxO = await findRewardFoldUTxO(
    lucid,
    config.configTN,
    rewardFoldValidatorAddr,
    rewardFoldPolicyId,
  );

  if (rewardUTxO.type == "error") return rewardUTxO;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const oldRewardFoldDatum = Data.from(rewardUTxO.data.datum!, RewardFoldDatum);

  if (oldRewardFoldDatum.currNode.next != null)
    return {
      type: "error",
      error: new Error("Cannot reclaim reward as Reward Fold is not completed"),
    };

  const userAddr = await lucid.wallet().address();
  const userPubKeyHash =
    getAddressDetails(userAddr).paymentCredential?.hash;

  if (!userPubKeyHash)
    return { type: "error", error: new Error("User PubKeyHash not found") };

  if (
    "PublicKeyCredential" in oldRewardFoldDatum.owner.paymentCredential &&
    userPubKeyHash !==
      oldRewardFoldDatum.owner.paymentCredential.PublicKeyCredential[0]
  )
    return {
      type: "error",
      error: new Error("User not authorized to reclaim reward"),
    };
  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  const rewardToken = toUnit(config.rewardCS, fromText(config.rewardTN));
  const remainingReward = rewardUTxO.data.assets[rewardToken];

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([rewardUTxO.data], Data.to("RewardsReclaim", RewardFoldAct))
      .mintAssets(
        { [toUnit(rewardFoldPolicyId, rFold)]: -1n },
        Data.to("BurnRewardFold", RewardFoldMintAct),
      )
      // If no rewards are left, the off-chain agent burns RFold token and
      // claims ADA. No asset is sent to project's penalty address.
      .compose(
        remainingReward > 0n
          ? lucid.newTx().pay.ToAddress(config.penaltyAddress, {
              [rewardToken]: remainingReward,
            })
          : null,
      )
      .addSigner(userAddr)
      .readFrom([
        config.refScripts.rewardFoldValidator,
        config.refScripts.rewardFoldPolicy,
        configUTxOResponse.data,
      ])
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
