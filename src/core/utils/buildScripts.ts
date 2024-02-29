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
  config: BuildScriptsConfig,
): Result<AppliedScripts> => {
  const alwaysFails: SpendingValidator = {
    type: "PlutusV2",
    script: config.alwaysFails,
  };
  const alwaysFailsAddr = lucid.utils.validatorToAddress(alwaysFails);
  const alwaysFailsAddrD = fromAddressToData(alwaysFailsAddr);
  if (alwaysFailsAddrD.type == "error") return alwaysFailsAddrD;

  // Config Minting Policy
  //
  // pmintConfigToken :: Term s (PAddress :--> PMintingPolicy)
  const configPolicyCbor = applyParamsToScript(config.configPolicy, [
    alwaysFailsAddrD.data,
  ]);

  const configPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: configPolicyCbor,
  };

  const configPolicyId = lucid.utils.mintingPolicyToId(configPolicy);

  // RewardTokenHolder Minting Policy
  //
  // pmintRewardTokenHolder :: Term s (PAsData PCurrencySymbol :--> PMintingPolicy)
  const tokenHolderPolicyCbor = applyParamsToScript(config.tokenHolderPolicy, [
    configPolicyId,
  ]);

  const tokenHolderPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: tokenHolderPolicyCbor,
  };

  // Node Minting Policy
  //
  // mkStakingNodeMPW :: ClosedTerm (PAsData PCurrencySymbol :--> PMintingPolicy)
  const nodePolicyCbor = applyParamsToScript(config.nodePolicy, [
    configPolicyId,
  ]);

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

  const foldValidatorCbor = applyParamsToScript(config.foldValidator, [
    configPolicyId,
    nodePolicyId,
  ]);

  const foldValidator: SpendingValidator = {
    type: "PlutusV2",
    script: foldValidatorCbor,
  };

  const foldValidatorAddress = fromAddressToData(
    lucid.utils.validatorToAddress(foldValidator),
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
    new Constr(0, [nodePolicyId, foldValidatorAddress.data, configPolicyId]),
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

  const rewardFoldValidatorCbor = applyParamsToScript(
    config.rewardFoldValidator,
    [configPolicyId, nodePolicyId],
  );

  const rewardFoldValidator: SpendingValidator = {
    type: "PlutusV2",
    script: rewardFoldValidatorCbor,
  };

  const rewardValidatorAddress = fromAddressToData(
    lucid.utils.validatorToAddress(rewardFoldValidator),
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
  const rewardFoldPolicyCbor = applyParamsToScript(config.rewardFoldPolicy, [
    new Constr(0, [
      nodePolicyId, // nodeCS
      lucid.utils.mintingPolicyToId(tokenHolderPolicy), //tokenHolderCS
      rewardValidatorAddress.data, // rewardScriptAddr
      lucid.utils.mintingPolicyToId(foldPolicy), // commitFoldCS
      configPolicyId, // configCS
    ]),
  ]);

  const rewardFoldPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: rewardFoldPolicyCbor,
  };

  // Node Stake Validator
  //
  // pDiscoverGlobalLogicW :: Term s (PAsData PCurrencySymbol :--> PStakeValidator)
  // pDiscoverGlobalLogicW = phoistAcyclic $ plam $ \rewardFoldCS' _redeemer ctx -> P.do

  const nodeStakeValidatorCbor = applyParamsToScript(
    config.nodeStakeValidator,
    [lucid.utils.mintingPolicyToId(rewardFoldPolicy)],
  );

  const nodeStakeValidator: WithdrawalValidator = {
    type: "PlutusV2",
    script: nodeStakeValidatorCbor,
  };

  // Node Spending Validator
  //
  // pStakingSetValidator ::
  //   ByteString ->
  //   ClosedTerm (PCurrencySymbol :--> PStakingCredential :--> PValidator)
  // pStakingSetValidator prefix = plam $ \configCS globalCred dat red ctx' ->
  const nodeValidatorCbor = applyParamsToScript(config.nodeValidator, [
    configPolicyId,
    new Constr(0, [
      new Constr(1, [lucid.utils.validatorToScriptHash(nodeStakeValidator)]),
    ]), // PStakingCredential
  ]);

  // Reward Token Holder Spending Validator
  //
  // prewardTokenHolder :: Term s (PCurrencySymbol :--> PAsData PCurrencySymbol :--> PValidator)
  // prewardTokenHolder = phoistAcyclic $
  //   plam $ \configCS rewardFoldCS dat _red ctx -> unTermCont $ do
  const tokenHolderValidatorCbor = applyParamsToScript(
    config.tokenHolderValidator,
    [configPolicyId, lucid.utils.mintingPolicyToId(rewardFoldPolicy)],
  );

  return {
    type: "ok",
    data: {
      configPolicy: configPolicyCbor,
      nodePolicy: nodePolicyCbor,
      nodeValidator: nodeValidatorCbor,
      nodeStakeValidator: nodeStakeValidatorCbor,
      foldPolicy: foldPolicyCbor,
      foldValidator: foldValidatorCbor,
      rewardFoldPolicy: rewardFoldPolicyCbor,
      rewardFoldValidator: rewardFoldValidatorCbor,
      tokenHolderPolicy: tokenHolderPolicyCbor,
      tokenHolderValidator: tokenHolderValidatorCbor,
    },
  };
};
