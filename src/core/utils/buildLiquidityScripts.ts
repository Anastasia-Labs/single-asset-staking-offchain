import {
    applyParamsToScript,
    Constr,
    fromText,
    Lucid,
    MintingPolicy,
    SpendingValidator,
    WithdrawalValidator,
  } from "@anastasia-labs/lucid-cardano-fork";
  import { BuildLiquidityScriptsConfig, CborHex, Result } from "../types.js";
  import { fromAddressToData } from "./utils.js";
  
  type LiquidityScripts = {
    liquidityPolicy: CborHex;
    liquidityValidator: CborHex;
    collectStake: CborHex;
    rewardStake: CborHex;
    collectFoldPolicy: CborHex;
    collectFoldValidator: CborHex;
    rewardFoldPolicy: CborHex;
    rewardFoldValidator: CborHex;
    tokenHolderPolicy: CborHex;
    tokenHolderValidator: CborHex;
  };
  
  export const buildLiquidityScripts = (
    lucid: Lucid,
    config: BuildLiquidityScriptsConfig
  ): Result<LiquidityScripts> => {
    const initUTXOprojectTokenHolder = new Constr(0, [
      new Constr(0, [config.projectTokenHolder.initUTXO.txHash]),
      BigInt(config.projectTokenHolder.initUTXO.outputIndex),
    ]);
  
    const tokenHolderPolicy = applyParamsToScript(
      config.unapplied.tokenHolderPolicy,
      [initUTXOprojectTokenHolder]
    );
  
    const tokenHolderMintingPolicy: MintingPolicy = {
      type: "PlutusV2",
      script: tokenHolderPolicy,
    };
  
    const initUTxO = new Constr(0, [
      new Constr(0, [config.liquidityPolicy.initUTXO.txHash]),
      BigInt(config.liquidityPolicy.initUTXO.outputIndex),
    ]);
  
    const penaltyAddress = fromAddressToData(
      config.liquidityPolicy.penaltyAddress
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
    //              , "stakingDeadline" ':= PPOSIXTime
    //              , "penaltyAddress" ':= PAddress
    //              ]
    //         )
    //     )
    const liquidityPolicy = applyParamsToScript(
      config.unapplied.liquidityPolicy,
      [
        new Constr(0, [
          initUTxO,
          BigInt(config.liquidityPolicy.deadline), // stakingDeadline PInteger
          penaltyAddress.data, // penaltyAddress PAddress
        ]),
      ]
    );
  
    const stakingMintingPolicy: MintingPolicy = {
      type: "PlutusV2",
      script: liquidityPolicy,
    };
  
    //NOTE: FOLD VALIDATOR
    //
    // pfoldValidatorW :: Term s (PAsData PCurrencySymbol :--> PAsData PPOSIXTime :--> PValidator)
    // pfoldValidatorW = phoistAcyclic $
    //   plam $ \nodeCS stakingDeadline datum redeemer ctx ->
    const foldValidator = applyParamsToScript(config.unapplied.collectFoldValidator, [
      lucid.utils.mintingPolicyToId(stakingMintingPolicy),
      BigInt(config.liquidityPolicy.deadline),
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
    //                , "stakingDeadline" ':= PPOSIXTime
    //                ]
    //           )
    //       )
    //   deriving stock (Generic)
    //   deriving anyclass (PlutusType, PIsData, PDataFields)
    // TODO: Fix applied parameters 
    const collectFoldPolicy = applyParamsToScript(config.unapplied.collectFoldPolicy, [
      new Constr(0, [
        lucid.utils.mintingPolicyToId(stakingMintingPolicy),
        foldValidatorAddress.data,
        BigInt(config.liquidityPolicy.deadline), // stakingDeadline PInteger
      ]),
    ]);
  
    const foldMintingPolicy: MintingPolicy = {
      type: "PlutusV2",
      script: collectFoldPolicy,
    };
  
    const projectAddress = fromAddressToData(config.rewardFoldValidator.projectAddr);
    if (projectAddress.type == "error")
      return { type: "error", error: projectAddress.error };
  
    //NOTE: REWARD VALIDATOR
    //
    // data PRewardFoldConfig (s :: S)
    //   = PRewardFoldConfig
    //       ( Term
    //           s
    //           ( PDataRecord
    //               '[ "nodeCS" ':= PCurrencySymbol
    //                , "projectCS" ':= PCurrencySymbol
    //                , "projectTN" ':= PTokenName
    //                , "projectAddr" ':= PAddress
    //                ]
    //           )
    //       )
    //   deriving stock (Generic)
    //   deriving anyclass (PlutusType, PIsData, PDataFields)
    const rewardFoldValidator = applyParamsToScript(
      config.unapplied.distributionFoldValidator,
      [
        new Constr(0, [
          lucid.utils.mintingPolicyToId(stakingMintingPolicy), //nodeCS
          config.rewardFoldValidator.projectCS, // projectCS
          fromText(config.rewardFoldValidator.projectTN), // projectTN
          projectAddress.data, // projectAddr
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
    //                  "projectTN" ':= PTokenName,
    //                  "projectCS" ':= PCurrencySymbol,
    //                  "commitFoldCS" ':= PCurrencySymbol
    //                ]
    //           )
    //       )
    const rewardFoldPolicy = applyParamsToScript(config.unapplied.distributionFoldPolicy, [
      new Constr(0, [
        lucid.utils.mintingPolicyToId(stakingMintingPolicy), // nodeCS
        lucid.utils.mintingPolicyToId(tokenHolderMintingPolicy), //tokenHolderCS
        rewardValidatorAddress.data, // rewardScriptAddr
        fromText(config.rewardFoldValidator.projectTN), // projectTN
        config.rewardFoldValidator.projectCS, // projectCS
        lucid.utils.mintingPolicyToId(foldMintingPolicy), // commitFoldCS
      ]),
    ]);
    const rewardMintingPolicy: MintingPolicy = {
      type: "PlutusV2",
      script: rewardFoldPolicy,
    };
  
    //NOTE: DISCOVERY STAKE VALIDATOR
    // pDiscoverGlobalLogicW :: Term s (PAsData PCurrencySymbol :--> PStakeValidator)
    // pDiscoverGlobalLogicW = phoistAcyclic $ plam $ \rewardCS' _redeemer ctx -> P.do
    const collectStake = applyParamsToScript(config.unapplied.liquidityStake, [
      lucid.utils.mintingPolicyToId(foldMintingPolicy),
    ]);
  
    const collectStakeValidator: WithdrawalValidator = {
      type: "PlutusV2",
      script: collectStake,
    };
    
    const rewardStake = applyParamsToScript(config.unapplied.liquidityStake, [
        lucid.utils.mintingPolicyToId(rewardMintingPolicy),
    ]);
    
    const rewardStakeValidator: WithdrawalValidator = {
        type: "PlutusV2",
        script: rewardStake,
    };

    // NOTE: DISCOVERY VALIDATOR
    //
    // data PStakingLaunchConfig (s :: S)
    //   = PStakingLaunchConfig
    //       ( Term
    //           s
    //           ( PDataRecord
    //               '[ "stakingDeadline" ':= PPOSIXTime
    //                , "penaltyAddress" ':= PAddress
    //                , "rewardsCS" ':= PCurrencySymbol
    //                ]
    //           )
    //       )
    const liquidityValidator = applyParamsToScript(
      config.unapplied.liquidityValidator,
      [
        new Constr(0, [
          BigInt(config.liquidityPolicy.deadline), // stakingDeadline PInteger
          penaltyAddress.data, // penaltyAddress PAddress
          new Constr(0, [new Constr(1, [lucid.utils.validatorToScriptHash(collectStakeValidator)])]), // PStakingCredential
          new Constr(0, [new Constr(1, [lucid.utils.validatorToScriptHash(rewardStakeValidator)])])
        ]),
      ]
    );
  
    const stakingSpendingValidator: SpendingValidator = {
      type: "PlutusV2",
      script: liquidityValidator,
    };
  
    //NOTE: PROJECT TOKEN HOLDER VALIDATOR
    // pprojectTokenHolder :: Term s (PAsData PCurrencySymbol :--> PValidator)
    // pprojectTokenHolder = phoistAcyclic $ plam $ \rewardsCS _dat _redeemer ctx -> unTermCont $ do
    const tokenHolderValidator = applyParamsToScript(
      config.unapplied.tokenHolderValidator,
      [lucid.utils.mintingPolicyToId(rewardMintingPolicy)]
    );
  
    return {
      type: "ok",
      data: {
        liquidityPolicy: liquidityPolicy,
        liquidityValidator: liquidityValidator,
        collectStake: collectStake,
        rewardStake: rewardStake,
        collectFoldPolicy: collectFoldPolicy,
        collectFoldValidator: foldValidator,
        rewardFoldPolicy: rewardFoldPolicy,
        rewardFoldValidator: rewardFoldValidator,
        tokenHolderPolicy: tokenHolderPolicy,
        tokenHolderValidator: tokenHolderValidator,
      },
    };
  };
  