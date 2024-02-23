import {
  applyParamsToScript,
  Constr,
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

  const alwaysFails: SpendingValidator = {
    type: "PlutusV2",
    script: config.alwaysFails,
  };
  const alwaysFailsAddr = lucid.utils.validatorToAddress(alwaysFails);
  const alwaysFailsAddrD = fromAddressToData(alwaysFailsAddr);
  if (alwaysFailsAddrD.type == "error")
    return alwaysFailsAddrD;

  // Config Minting Policy
  //
  // pmintConfigToken :: Term s (PAddress :--> PMintingPolicy)
  const configPolicyCbor = applyParamsToScript(config.configPolicy, 
    [alwaysFailsAddrD.data]
  );

  const configPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: configPolicyCbor,
  };

  const configPolicyId = lucid.utils.mintingPolicyToId(configPolicy);
  
  // RewardTokenHolder Minting Policy
  //
  // pmintRewardTokenHolder :: Term s (PCurrencySymbol :--> PMintingPolicy)
  const tokenHolderPolicy = applyParamsToScript(
    config.tokenHolderPolicy,
    [configPolicyId]
  );

  const tokenHolderMintingPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: tokenHolderPolicy,
  };

  // Node Minting Policy
  //
  // mkStakingNodeMPW :: ClosedTerm (PCurrencySymbol :--> PMintingPolicy)
  const nodePolicyCbor = applyParamsToScript(
    config.nodePolicy,
    [configPolicyId]
  );

  const nodePolicy: MintingPolicy = {
    type: "PlutusV2",
    script: nodePolicyCbor,
  };

  const nodePolicyId = lucid.utils.mintingPolicyToId(nodePolicy);

  // Commit Fold Spending Validator
  //
  // pfoldValidatorW :: Term s (PCurrencySymbol :--> PCurrencySymbol :--> PValidator)
  // pfoldValidatorW = phoistAcyclic $
  // plam $ \configCS nodeCS datum redeemer ctx -> P.do

  const foldValidator = applyParamsToScript(config.foldValidator, [
    configPolicyId,
    nodePolicyId
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
  //                , "configCS" ':= PCurrencySymbol
  //                ]
  //           )
  //       )

  const foldPolicyCbor = applyParamsToScript(config.foldPolicy, [
    new Constr(0, [
      nodePolicyId,
      foldValidatorAddress.data,
      configPolicyId,
    ]),
  ]);

  const foldPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: foldPolicyCbor,
  };

  // Reward Fold Spending Validator
  //
  // prewardFoldValidatorW :: Term s (PCurrencySymbol :--> PCurrencySymbol :--> PValidator)
  // prewardFoldValidatorW = phoistAcyclic $
  //   plam $ \configCS nodeCS datum redeemer ctx -> P.do

  const rewardFoldValidator = applyParamsToScript(
    config.rewardFoldValidator,
    [
      configPolicyId,
      nodePolicyId
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
  //               '[ "nodeCS" ':= PCurrencySymbol
  //               , "tokenHolderCS" ':= PCurrencySymbol
  //               , "rewardScriptAddr" ':= PAddress
  //               , "commitFoldCS" ':= PCurrencySymbol
  //               , "configCS" ':= PCurrencySymbol
  //               ]
  //           )
  //       )
  const rewardFoldPolicy = applyParamsToScript(config.rewardFoldPolicy, [
    new Constr(0, [
      nodePolicyId, // nodeCS
      lucid.utils.mintingPolicyToId(tokenHolderMintingPolicy), //tokenHolderCS
      rewardValidatorAddress.data, // rewardScriptAddr
      lucid.utils.mintingPolicyToId(foldPolicy), // commitFoldCS
      configPolicyId // configCS
    ]),
  ]);

  const rewardMintingPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: rewardFoldPolicy,
  };

  // Node Stake Validator
  // 
  // pDiscoverGlobalLogicW :: Term s (PAsData PCurrencySymbol :--> PStakeValidator)
  // pDiscoverGlobalLogicW = phoistAcyclic $ plam $ \rewardFoldCS' _redeemer ctx -> P.do

  const nodeStakeValidator = applyParamsToScript(config.nodeStakeValidator, [
    lucid.utils.mintingPolicyToId(rewardMintingPolicy),
  ]);

  const nodeStakeValidatorScript : WithdrawalValidator = {
    type: "PlutusV2",
    script: nodeStakeValidator,
  };

  // Node Spending Validator
  //
  // pStakingSetValidator ::
  //   ByteString ->
  //   ClosedTerm (PCurrencySymbol :--> PStakingCredential :--> PValidator)
  // pStakingSetValidator prefix = plam $ \configCS globalCred dat red ctx' ->
  const nodeValidator = applyParamsToScript(
    config.nodeValidator,
    [
      configPolicyId,
      new Constr(0, 
        [new Constr(1, [lucid.utils.validatorToScriptHash(nodeStakeValidatorScript)])]
      ), // PStakingCredential
    ]
  );

  // Reward Token Holder Spending Validator
  // 
  // prewardTokenHolder :: Term s (PCurrencySymbol :--> PAsData PCurrencySymbol :--> PValidator)
  // prewardTokenHolder = phoistAcyclic $
  //   plam $ \configCS rewardFoldCS dat _red ctx -> unTermCont $ do
  const tokenHolderValidator = applyParamsToScript(
    config.tokenHolderValidator,
    [
      configPolicyId, 
      lucid.utils.mintingPolicyToId(rewardMintingPolicy)
    ]
  );

  return {
    type: "ok",
    data: {
      configPolicy: configPolicyCbor,
      nodePolicy: nodePolicyCbor,
      nodeValidator: nodeValidator,
      nodeStakeValidator: nodeStakeValidator,
      foldPolicy: foldPolicyCbor,
      foldValidator: foldValidator,
      rewardFoldPolicy: rewardFoldPolicy,
      rewardFoldValidator: rewardFoldValidator,
      tokenHolderPolicy: tokenHolderPolicy,
      tokenHolderValidator: tokenHolderValidator,
    },
  };
};
