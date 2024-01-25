import {
  applyParamsToScript,
  Constr,
  fromText,
  Lucid,
  MintingPolicy,
  SpendingValidator,
  WithdrawalValidator,
} from "@anastasia-labs/lucid-cardano-fork";
import { BuildScriptsConfig, CborHex, Result } from "../types.js";
import { fromAddressToData } from "./utils.js";

export type Scripts = {
  stakingPolicy: CborHex;
  stakingValidator: CborHex;
  stakingStakeValidator: CborHex;
  foldPolicy: CborHex;
  foldValidator: CborHex;
  rewardPolicy: CborHex;
  rewardValidator: CborHex;
  tokenHolderPolicy: CborHex;
  tokenHolderValidator: CborHex;
};

export const buildScripts = (
  lucid: Lucid,
  config: BuildScriptsConfig
): Result<Scripts> => {
  const initUTXOrewardTokenHolder = new Constr(0, [
    new Constr(0, [config.rewardTokenHolder.initUTXO.txHash]),
    BigInt(config.rewardTokenHolder.initUTXO.outputIndex),
  ]);

  const tokenHolderPolicy = applyParamsToScript(
    config.unapplied.tokenHolderPolicy,
    [initUTXOrewardTokenHolder]
  );

  const tokenHolderMintingPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: tokenHolderPolicy,
  };

  const initUTxO = new Constr(0, [
    new Constr(0, [config.stakingPolicy.initUTXO.txHash]),
    BigInt(config.stakingPolicy.initUTXO.outputIndex),
  ]);

  const penaltyAddress = fromAddressToData(
    config.stakingPolicy.penaltyAddress
  );

  if (penaltyAddress.type == "error")
    return { type: "error", error: penaltyAddress.error };

  //NOTE: DISCOVERY POLICY
  //
  // data PStakingConfig (s :: S)
  // = PStakingConfig
  //     ( Term
  //         s
  //         ( PDataRecord
  //             '[ "initUTxO" ':= PTxOutRef
  //              , "freezeStake" ':= PPOSIXTime
  //              , "penaltyAddress" ':= PAddress
  //              ]
  //         )
  //     )
  const stakingPolicy = applyParamsToScript(
    config.unapplied.stakingPolicy,
    [
      new Constr(0, [
        initUTxO,
        BigInt(config.stakingPolicy.freezeStake), // freezeStake PInteger
        penaltyAddress.data, // penaltyAddress PAddress
      ]),
    ]
  );

  const stakingMintPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: stakingPolicy,
  };

  //NOTE: FOLD VALIDATOR
  //
  // pfoldValidatorW :: Term s (PAsData PCurrencySymbol :--> PAsData PPOSIXTime :--> PValidator)
  // pfoldValidatorW = phoistAcyclic $
  //   plam $ \nodeCS freezeStake datum redeemer ctx ->
  const foldValidator = applyParamsToScript(config.unapplied.foldValidator, [
    lucid.utils.mintingPolicyToId(stakingMintPolicy),
    BigInt(config.stakingPolicy.freezeStake),
  ]);
  const foldSpendingValidator: SpendingValidator = {
    type: "PlutusV2",
    script: foldValidator,
  };

  const foldValidatorAddress = fromAddressToData(
    lucid.utils.validatorToAddress(foldSpendingValidator)
  );

  if (foldValidatorAddress.type == "error")
    return { type: "error", error: foldValidatorAddress.error };

  //NOTE: FOLD POLICY
  //
  // data PFoldMintConfig (s :: S)
  //   = PFoldMintConfig
  //       ( Term
  //           s
  //           ( PDataRecord
  //               '[ "nodeCS" ':= PCurrencySymbol
  //                , "foldAddr" ':= PAddress
  //                , "freezeStake" ':= PPOSIXTime
  //                ]
  //           )
  //       )
  //   deriving stock (Generic)
  //   deriving anyclass (PlutusType, PIsData, PDataFields)
  const foldPolicy = applyParamsToScript(config.unapplied.foldPolicy, [
    new Constr(0, [
      lucid.utils.mintingPolicyToId(stakingMintPolicy),
      foldValidatorAddress.data,
      BigInt(config.stakingPolicy.freezeStake), // freezeStake PInteger
    ]),
  ]);

  const foldMintingPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: foldPolicy,
  };

  const rewardAddress = fromAddressToData(config.rewardValidator.rewardAddr);
  if (rewardAddress.type == "error")
    return { type: "error", error: rewardAddress.error };

  //NOTE: REWARD VALIDATOR
  //
  // data PRewardFoldConfig (s :: S)
  //   = PRewardFoldConfig
  //       ( Term
  //           s
  //           ( PDataRecord
  //               '[ "nodeCS" ':= PCurrencySymbol
  //                , "rewardCS" ':= PCurrencySymbol
  //                , "rewardTN" ':= PTokenName
  //                , "rewardAddr" ':= PAddress
  //                ]
  //           )
  //       )
  //   deriving stock (Generic)
  //   deriving anyclass (PlutusType, PIsData, PDataFields)
  const rewardValidator = applyParamsToScript(
    config.unapplied.rewardValidator,
    [
      new Constr(0, [
        lucid.utils.mintingPolicyToId(stakingMintPolicy), //nodeCS
        config.rewardValidator.rewardCS, // rewardCS
        fromText(config.rewardValidator.rewardTN), // rewardTN
        rewardAddress.data, // rewardAddr
      ]),
    ]
  );

  const rewardSpendingValidator: SpendingValidator = {
    type: "PlutusV2",
    script: rewardValidator,
  };

  const rewardValidatorAddress = fromAddressToData(
    lucid.utils.validatorToAddress(rewardSpendingValidator)
  );

  if (rewardValidatorAddress.type == "error")
    return { type: "error", error: rewardValidatorAddress.error };

  //NOTE: REWARD POLICY
  //
  // data PRewardMintFoldConfig (s :: S)
  //   = PRewardMintFoldConfig
  //       ( Term
  //           s
  //           ( PDataRecord
  //               '[ "nodeCS" ':= PCurrencySymbol,
  //                  "tokenHolderCS" ':= PCurrencySymbol,
  //                  "rewardScriptAddr" ':= PAddress,
  //                  "rewardTN" ':= PTokenName,
  //                  "rewardCS" ':= PCurrencySymbol,
  //                  "commitFoldCS" ':= PCurrencySymbol
  //                ]
  //           )
  //       )
  const rewardPolicy = applyParamsToScript(config.unapplied.rewardPolicy, [
    new Constr(0, [
      lucid.utils.mintingPolicyToId(stakingMintPolicy), // nodeCS
      lucid.utils.mintingPolicyToId(tokenHolderMintingPolicy), //tokenHolderCS
      rewardValidatorAddress.data, // rewardScriptAddr
      fromText(config.rewardValidator.rewardTN), // rewardTN
      config.rewardValidator.rewardCS, // rewardCS
      lucid.utils.mintingPolicyToId(foldMintingPolicy), // commitFoldCS
    ]),
  ]);
  const rewardMintingPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: rewardPolicy,
  };

  //NOTE: DISCOVERY STAKE VALIDATOR
  // pDiscoverGlobalLogicW :: Term s (PAsData PCurrencySymbol :--> PStakeValidator)
  // pDiscoverGlobalLogicW = phoistAcyclic $ plam $ \rewardCS' _redeemer ctx -> P.do
  const stakingStakeValidator = applyParamsToScript(config.unapplied.stakingStakeValidator, [
    lucid.utils.mintingPolicyToId(rewardMintingPolicy),
  ]);

  const stakingStakeValidator: WithdrawalValidator = {
    type: "PlutusV2",
    script: stakingStakeValidator,
  };

  // NOTE: DISCOVERY VALIDATOR
  //
  // data PStakingLaunchConfig (s :: S)
  //   = PStakingLaunchConfig
  //       ( Term
  //           s
  //           ( PDataRecord
  //               '[ "freezeStake" ':= PPOSIXTime
  //                , "penaltyAddress" ':= PAddress
  //                , "rewardsCS" ':= PCurrencySymbol
  //                ]
  //           )
  //       )
  const stakingValidator = applyParamsToScript(
    config.unapplied.stakingValidator,
    [
      new Constr(0, [
        BigInt(config.stakingPolicy.freezeStake), // freezeStake PInteger
        penaltyAddress.data, // penaltyAddress PAddress
        new Constr(0, [new Constr(1, [lucid.utils.validatorToScriptHash(stakingStakeValidator)])]), // PStakingCredential
      ]),
    ]
  );

  const stakingSpendingValidator: SpendingValidator = {
    type: "PlutusV2",
    script: stakingValidator,
  };

  //NOTE: PROJECT TOKEN HOLDER VALIDATOR
  // prewardTokenHolder :: Term s (PAsData PCurrencySymbol :--> PValidator)
  // prewardTokenHolder = phoistAcyclic $ plam $ \rewardsCS _dat _redeemer ctx -> unTermCont $ do
  const tokenHolderValidator = applyParamsToScript(
    config.unapplied.tokenHolderValidator,
    [lucid.utils.mintingPolicyToId(rewardMintingPolicy)]
  );

  return {
    type: "ok",
    data: {
      stakingPolicy: stakingPolicy,
      stakingValidator: stakingValidator,
      stakingStakeValidator: stakingStakeValidator,
      foldPolicy: foldPolicy,
      foldValidator: foldValidator,
      rewardPolicy: rewardPolicy,
      rewardValidator: rewardValidator,
      tokenHolderPolicy: tokenHolderPolicy,
      tokenHolderValidator: tokenHolderValidator,
    },
  };
};
