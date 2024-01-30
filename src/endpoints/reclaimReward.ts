import {
  Lucid,
  SpendingValidator,
  Data,
  TxComplete,
  MintingPolicy,
  toUnit,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  RewardFoldDatum,
  RewardFoldAct
} from "../core/contract.types.js";
import { Result, RewardFoldConfig } from "../core/types.js";
import {
  rFold,
} from "../index.js";

export const reclaimReward = async (
  lucid: Lucid,
  config: RewardFoldConfig
): Promise<Result<TxComplete>> => {

  const rewardFoldValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.rewardFoldValidator,
  };

  const rewardFoldPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: config.scripts.rewardFoldPolicy,
  };
  const rewardFoldPolicyId = lucid.utils.mintingPolicyToId(rewardFoldPolicy);

  const [rewardUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress(rewardFoldValidator),
    toUnit(rewardFoldPolicyId, rFold)
  );
  
  if (!rewardUTxO.datum)
    return { type: "error", error: new Error("missing RewardFoldDatum") };

  const oldRewardFoldDatum = Data.from(rewardUTxO.datum, RewardFoldDatum);

  if(oldRewardFoldDatum.currNode.next != null)
    return { type: "error", error: new Error("Cannot reclaim reward as Reward Fold is not completed")}

  const userAddr = await lucid.wallet.address();
  const userPubKeyHash = lucid.utils.getAddressDetails(userAddr).paymentCredential?.hash;
  
  if(!userPubKeyHash)
    return { type: "error", error: new Error("User PubKeyHash not found")}

  if("PublicKeyCredential" in oldRewardFoldDatum.owner.paymentCredential && 
      userPubKeyHash !== oldRewardFoldDatum.owner.paymentCredential.PublicKeyCredential[0])
    return { type: "error", error: new Error("User not authorized to reclaim reward") }  
  
  try {
    const tx = await lucid
      .newTx()
      .collectFrom([rewardUTxO], Data.to("RewardsReclaim", RewardFoldAct))
      .addSigner(userPubKeyHash)
      .compose(
        config.refScripts?.rewardFoldValidator
          ? lucid.newTx().readFrom([config.refScripts.rewardFoldValidator])
          : lucid.newTx().attachSpendingValidator(rewardFoldValidator)
      )
      .complete()

    return { type: "ok", data: tx }
    
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
