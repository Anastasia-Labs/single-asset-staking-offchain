import {
  applyParamsToScript,
  Constr,
  fromText,
  Lucid,
  MintingPolicy,
  SpendingValidator,
  WithdrawalValidator,
} from "@anastasia-labs/lucid-cardano-fork";
import { AppliedScripts, BuildScriptsConfig, Result } from "../types.js";
import { fromAddressToData } from "./utils.js";

export const buildScripts = (
  lucid: Lucid,
  config: BuildScriptsConfig
): Result<AppliedScripts> => {
  
  // RewardTokenHolder Minting Policy
  const initUTxORewardTokenHolder = new Constr(0, [
    new Constr(0, [config.rewardTokenHolder.initUTXO.txHash]),
    BigInt(config.rewardTokenHolder.initUTXO.outputIndex),
  ]);

  const tokenHolderPolicy = applyParamsToScript(
    config.unapplied.tokenHolderPolicy,
    [initUTxORewardTokenHolder]
  );

  const tokenHolderMintingPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: tokenHolderPolicy,
  };

  // Staking Minting Policy
  //
  // data PStakingConfig (s :: S)
  // = PStakingConfig
  // ( Term
  //     s
  //     ( PDataRecord
  //         '[ "initUTxO" ':= PTxOutRef
  //         , "freezeStake" ':= PPOSIXTime
  //         , "endStaking" ':= PPOSIXTime
  //         , "penaltyAddress" ':= PAddress
  //         , "stakeCS" ':= PCurrencySymbol
  //         , "stakeTN" ':= PTokenName
  //         , "minimumStake" ':= PInteger
  //         ]
  //     )
  // )
  
  const initUTxO = new Constr(0, [
    new Constr(0, [config.stakingPolicy.initUTXO.txHash]),
    BigInt(config.stakingPolicy.initUTXO.outputIndex),
  ]);

  const penaltyAddress = fromAddressToData(
    config.stakingPolicy.penaltyAddress
  );

  if (penaltyAddress.type == "error")
    return { type: "error", error: penaltyAddress.error };

  const stakingPolicy = applyParamsToScript(
    config.unapplied.stakingPolicy,
    [
      new Constr(0, [
        initUTxO,
        BigInt(config.stakingPolicy.freezeStake),
        BigInt(config.stakingPolicy.endStaking),
        penaltyAddress.data,
        config.stakingPolicy.stakeCS,
        fromText(config.stakingPolicy.stakeTN),
        BigInt(config.stakingPolicy.minimumStake)
      ]),
    ]
  );

  const stakingMintPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: stakingPolicy,
  };

  // Commit Fold Spending Validator
  //
  // data PFoldConfig (s :: S)
  // = PFoldConfig
  //     ( Term
  //         s
  //         ( PDataRecord
  //             '[ "nodeCS" ':= PCurrencySymbol
  //              , "stakeCS" ':= PCurrencySymbol
  //              , "stakeTN" ':= PTokenName
  //              , "endStaking" ':= PPOSIXTime
  //              ]
  //         )
  //     )
  const foldValidator = applyParamsToScript(config.unapplied.foldValidator, [
    new Constr(0, [
      lucid.utils.mintingPolicyToId(stakingMintPolicy),
      config.stakingPolicy.stakeCS,
      fromText(config.stakingPolicy.stakeTN),
      BigInt(config.stakingPolicy.endStaking),
    ])
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

  // Commit Fold Minting Policy
  //
  // data PFoldMintConfig (s :: S)
  //   = PFoldMintConfig
  //       ( Term
  //           s
  //           ( PDataRecord
  //               '[ "nodeCS" ':= PCurrencySymbol
  //                , "foldAddr" ':= PAddress
  //                , "endStaking" ':= PPOSIXTime
  //                ]
  //           )
  //       )
  const foldPolicy = applyParamsToScript(config.unapplied.foldPolicy, [
    new Constr(0, [
      lucid.utils.mintingPolicyToId(stakingMintPolicy),
      foldValidatorAddress.data,
      BigInt(config.stakingPolicy.endStaking),
    ]),
  ]);

  const foldMintingPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: foldPolicy,
  };

  // Reward Fold Spending Validator
  //
  // data PRewardFoldConfig (s :: S)
  // = PRewardFoldConfig
  //     ( Term
  //         s
  //         ( PDataRecord
  //             '[ "nodeCS" ':= PCurrencySymbol
  //              , "rewardCS" ':= PCurrencySymbol
  //              , "rewardTN" ':= PTokenName
  //              , "stakeCS" ':= PCurrencySymbol
  //              , "stakeTN" ':= PTokenName
  //              ]
  //         )
  //     )
  const rewardValidator = applyParamsToScript(
    config.unapplied.rewardValidator,
    [
      new Constr(0, [
        lucid.utils.mintingPolicyToId(stakingMintPolicy), //nodeCS
        config.rewardValidator.rewardCS, 
        fromText(config.rewardValidator.rewardTN),
        config.stakingPolicy.stakeCS,
        fromText(config.stakingPolicy.stakeTN),
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

  // Reward Fold Minting Policy
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

  // Staking Stake Validator
  // 
  // pDiscoverGlobalLogicW :: Term s (PAsData PCurrencySymbol :--> PStakeValidator)
  // pDiscoverGlobalLogicW = phoistAcyclic $ plam $ \rewardFoldCS' _redeemer ctx -> P.do

  const stakingStakeValidator = applyParamsToScript(config.unapplied.stakingStakeValidator, [
    lucid.utils.mintingPolicyToId(rewardMintingPolicy),
  ]);

  const stakingStakeValidatorScript : WithdrawalValidator = {
    type: "PlutusV2",
    script: stakingStakeValidator,
  };

  // Staking Spending Validator
  //
  // data PStakingLaunchConfig (s :: S)
  // = PStakingLaunchConfig
  //     ( Term
  //         s
  //         ( PDataRecord
  //             '[ "freezeStake" ':= PPOSIXTime
  //              , "globalCred" ':= PStakingCredential
  //              , "stakeCS" ':= PCurrencySymbol
  //              , "stakeTN" ':= PTokenName
  //              , "minimumStake" ':= PInteger
  //              ]
  //         )
  //     )
  const stakingValidator = applyParamsToScript(
    config.unapplied.stakingValidator,
    [
      new Constr(0, [
        BigInt(config.stakingPolicy.freezeStake), // freezeStake PInteger
        new Constr(0, [new Constr(1, [lucid.utils.validatorToScriptHash(stakingStakeValidatorScript)])]), // PStakingCredential
        config.stakingPolicy.stakeCS,
        fromText(config.stakingPolicy.stakeTN),
        BigInt(config.stakingPolicy.minimumStake)
      ]),
    ]
  );

  // Reward Token Holder Spending Validator
  // 
  // prewardTokenHolder :: Term s (PAsData PCurrencySymbol :--> PValidator)
  // prewardTokenHolder = phoistAcyclic $ plam $ \rewardFoldCS _dat _redeemer ctx -> unTermCont $ do
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
