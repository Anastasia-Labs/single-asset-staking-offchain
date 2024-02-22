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
    new Constr(0, [config.nodePolicy.initUTXO.txHash]),
    BigInt(config.nodePolicy.initUTXO.outputIndex),
  ]);

  const penaltyAddress = fromAddressToData(
    config.nodePolicy.penaltyAddress
  );

  if (penaltyAddress.type == "error")
    return { type: "error", error: penaltyAddress.error };

  const nodePolicy = applyParamsToScript(
    config.unapplied.nodePolicy,
    [
      new Constr(0, [
        initUTxO,
        BigInt(config.nodePolicy.freezeStake),
        BigInt(config.nodePolicy.endStaking),
        penaltyAddress.data,
        config.nodePolicy.stakeCS,
        fromText(config.nodePolicy.stakeTN),
        BigInt(config.nodePolicy.minimumStake)
      ]),
    ]
  );

  const stakingMintPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: nodePolicy,
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
      config.nodePolicy.stakeCS,
      fromText(config.nodePolicy.stakeTN),
      BigInt(config.nodePolicy.endStaking),
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
      BigInt(config.nodePolicy.endStaking),
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
  const rewardFoldValidator = applyParamsToScript(
    config.unapplied.rewardFoldValidator,
    [
      new Constr(0, [
        lucid.utils.mintingPolicyToId(stakingMintPolicy), //nodeCS
        config.rewardFoldValidator.rewardCS, 
        fromText(config.rewardFoldValidator.rewardTN),
        config.nodePolicy.stakeCS,
        fromText(config.nodePolicy.stakeTN),
      ]),
    ]
  );

  const rewardSpendingValidator: SpendingValidator = {
    type: "PlutusV2",
    script: rewardFoldValidator,
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
  const rewardFoldPolicy = applyParamsToScript(config.unapplied.rewardFoldPolicy, [
    new Constr(0, [
      lucid.utils.mintingPolicyToId(stakingMintPolicy), // nodeCS
      lucid.utils.mintingPolicyToId(tokenHolderMintingPolicy), //tokenHolderCS
      rewardValidatorAddress.data, // rewardScriptAddr
      fromText(config.rewardFoldValidator.rewardTN), // rewardTN
      config.rewardFoldValidator.rewardCS, // rewardCS
      lucid.utils.mintingPolicyToId(foldMintingPolicy), // commitFoldCS
    ]),
  ]);

  const rewardMintingPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: rewardFoldPolicy,
  };

  // Staking Stake Validator
  // 
  // pDiscoverGlobalLogicW :: Term s (PAsData PCurrencySymbol :--> PStakeValidator)
  // pDiscoverGlobalLogicW = phoistAcyclic $ plam $ \rewardFoldCS' _redeemer ctx -> P.do

  const nodeStakeValidator = applyParamsToScript(config.unapplied.nodeStakeValidator, [
    lucid.utils.mintingPolicyToId(rewardMintingPolicy),
  ]);

  const stakingStakeValidatorScript : WithdrawalValidator = {
    type: "PlutusV2",
    script: nodeStakeValidator,
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
  const nodeValidator = applyParamsToScript(
    config.unapplied.nodeValidator,
    [
      new Constr(0, [
        BigInt(config.nodePolicy.freezeStake), // freezeStake PInteger
        new Constr(0, [new Constr(1, [lucid.utils.validatorToScriptHash(stakingStakeValidatorScript)])]), // PStakingCredential
        config.nodePolicy.stakeCS,
        fromText(config.nodePolicy.stakeTN),
        BigInt(config.nodePolicy.minimumStake)
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
      nodePolicy: nodePolicy,
      nodeValidator: nodeValidator,
      nodeStakeValidator: nodeStakeValidator,
      foldPolicy: foldPolicy,
      foldValidator: foldValidator,
      rewardFoldPolicy: rewardFoldPolicy,
      rewardFoldValidator: rewardFoldValidator,
      tokenHolderPolicy: tokenHolderPolicy,
      tokenHolderValidator: tokenHolderValidator,
    },
  };
};
