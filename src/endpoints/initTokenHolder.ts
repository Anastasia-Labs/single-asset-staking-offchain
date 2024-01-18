import {
  Lucid,
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  TxComplete,
  fromText,
} from "@anastasia-labs/lucid-cardano-fork";
import { PTHOLDER } from "../core/constants.js";
import { InitTokenHolderConfig, Result } from "../core/types.js";

export const TokenHolderMintActionSchema = Data.Enum([
  Data.Literal("PMintHolder"),
  Data.Literal("PBurnHolder"),
]);
export type TokenHolderMintAction = Data.Static<
  typeof TokenHolderMintActionSchema
>;
export const TokenHolderMintAction =
  TokenHolderMintActionSchema as unknown as TokenHolderMintAction;

export const initTokenHolder = async (
  lucid: Lucid,
  config: InitTokenHolderConfig
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

  const ptHolderAsset = toUnit(tokenHolderPolicyId, fromText(PTHOLDER));
  const mintPTHolderAct = Data.to("PMintHolder", TokenHolderMintAction);

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([config.initUTXO])
      .payToContract(
        tokenHolderValidatorAddr,
        { inline: Data.void() },
        {
          [ptHolderAsset]: BigInt(1),
          [toUnit(config.projectCS, fromText(config.projectTN))]: BigInt(
            config.projectAmount
          ),
        }
      )
      .mintAssets({ [ptHolderAsset]: BigInt(1) }, mintPTHolderAct)
      .attachMintingPolicy(tokenHolderPolicy)
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
