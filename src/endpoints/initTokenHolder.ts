import {
  Lucid,
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  TxComplete,
  fromText,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  PROTOCOL_FEE,
  PROTOCOL_PAYMENT_KEY,
  PROTOCOL_STAKE_KEY,
  RTHOLDER,
} from "../core/constants.js";
import { InitTokenHolderConfig, Result } from "../core/types.js";
import { TokenHolderMintAction } from "../index.js";

export const initTokenHolder = async (
  lucid: Lucid,
  config: InitTokenHolderConfig,
): Promise<Result<TxComplete>> => {
  const tokenHolderValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.tokenHolderValidator,
  };

  const tokenHolderValidatorAddr =
    lucid.utils.validatorToAddress(tokenHolderValidator);

  const tokenHolderPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: config.scripts.tokenHolderPolicy,
  };

  const tokenHolderPolicyId = lucid.utils.mintingPolicyToId(tokenHolderPolicy);

  const rewardToken = toUnit(config.rewardCS, fromText(config.rewardTN));
  const rtHolderAsset = toUnit(tokenHolderPolicyId, fromText(RTHOLDER));
  const mintRTHolderAct = Data.to("PMintHolder", TokenHolderMintAction);

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([config.initUTXO])
      .payToContract(
        tokenHolderValidatorAddr,
        { inline: Data.void() },
        {
          [rtHolderAsset]: BigInt(1),
          [rewardToken]: BigInt(config.rewardAmount),
        },
      )
      .mintAssets({ [rtHolderAsset]: BigInt(1) }, mintRTHolderAct)
      .payToAddress(
        lucid.utils.credentialToAddress(
          lucid.utils.keyHashToCredential(PROTOCOL_PAYMENT_KEY),
          lucid.utils.keyHashToCredential(PROTOCOL_STAKE_KEY),
        ),
        {
          [rewardToken]: BigInt(config.rewardAmount * PROTOCOL_FEE),
        },
      )
      .compose(
        config.refScripts?.tokenHolderPolicy
          ? lucid.newTx().readFrom([config.refScripts.tokenHolderPolicy])
          : lucid.newTx().attachMintingPolicy(tokenHolderPolicy),
      )
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
