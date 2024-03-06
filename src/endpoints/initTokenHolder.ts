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
import { fetchConfigUTxO } from "./fetchConfig.js";

export const initTokenHolder = async (
  lucid: Lucid,
  config: InitTokenHolderConfig,
): Promise<Result<TxComplete>> => {
  if (
    !config.refScripts.tokenHolderValidator.scriptRef ||
    !config.refScripts.tokenHolderPolicy.scriptRef
  )
    return { type: "error", error: new Error("Missing Script Reference") };

  const tokenHolderValidator: SpendingValidator =
    config.refScripts.tokenHolderValidator.scriptRef;
  const tokenHolderValidatorAddr =
    lucid.utils.validatorToAddress(tokenHolderValidator);

  const tokenHolderPolicy: MintingPolicy =
    config.refScripts.tokenHolderPolicy.scriptRef;
  const tokenHolderPolicyId = lucid.utils.mintingPolicyToId(tokenHolderPolicy);

  const rewardToken = toUnit(config.rewardCS, fromText(config.rewardTN));
  const rtHolderAsset = toUnit(tokenHolderPolicyId, fromText(RTHOLDER));
  const mintRTHolderAct = Data.to("PMintHolder", TokenHolderMintAction);

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([config.rewardInitUTXO])
      .payToContract(
        tokenHolderValidatorAddr,
        { inline: Data.to(config.configTN) },
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
      .readFrom([config.refScripts.tokenHolderPolicy, configUTxOResponse.data])
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
