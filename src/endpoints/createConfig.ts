import {
  Lucid,
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  TxComplete,
  fromText,
} from "@anastasia-labs/lucid-cardano-fork";
import { OutputReference, StakingConfig } from "../core/contract.types.js";
import { CreateConfig, Result } from "../core/types.js";
import { fromAddress, getUniqueTokenName } from "../index.js";

export const createConfig = async (
  lucid: Lucid,
  config: CreateConfig,
): Promise<Result<{ tx: TxComplete; configTN: string }>> => {
  const alwaysFails: SpendingValidator = {
    type: "PlutusV2",
    script: config.alwaysFails,
  };
  const alwaysFailsAddr = lucid.utils.validatorToAddress(alwaysFails);

  if (!config.refScripts.configPolicy.scriptRef)
    return { type: "error", error: new Error("Missing Script Reference") };

  const configPolicy: MintingPolicy = config.refScripts.configPolicy.scriptRef;
  const configPolicyId = lucid.utils.mintingPolicyToId(configPolicy);
  const configTN = await getUniqueTokenName(config.configInitUTXO);

  const assets = {
    [toUnit(configPolicyId, configTN)]: 1n,
  };

  const redeemerConfigPolicy = Data.to(
    {
      txHash: { hash: config.configInitUTXO.txHash },
      outputIndex: BigInt(config.configInitUTXO.outputIndex),
    },
    OutputReference,
  );

  const stakingConfig = config.stakingConfig;

  const stakingConfigDatum = {
    stakingInitUTxO: {
      txHash: { hash: stakingConfig.stakingInitUTXO.txHash },
      outputIndex: BigInt(stakingConfig.stakingInitUTXO.outputIndex),
    },
    rewardInitUTxO: {
      txHash: { hash: stakingConfig.rewardInitUTXO.txHash },
      outputIndex: BigInt(stakingConfig.rewardInitUTXO.outputIndex),
    },
    freezeStake: BigInt(stakingConfig.freezeStake),
    endStaking: BigInt(stakingConfig.endStaking),
    penaltyAddress: fromAddress(stakingConfig.penaltyAddress),
    stakeCS: stakingConfig.stakeCS,
    stakeTN: fromText(stakingConfig.stakeTN),
    minimumStake: BigInt(stakingConfig.minimumStake),
    rewardCS: stakingConfig.rewardCS,
    rewardTN: fromText(stakingConfig.rewardTN),
  };

  const datum = Data.to(stakingConfigDatum, StakingConfig);

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([config.configInitUTXO])
      .payToContract(alwaysFailsAddr, { inline: datum }, assets)
      .mintAssets(assets, redeemerConfigPolicy)
      .readFrom([config.refScripts.configPolicy])
      .complete();

    return { type: "ok", data: { tx: tx, configTN: configTN } };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
