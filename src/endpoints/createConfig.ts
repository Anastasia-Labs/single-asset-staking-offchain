import {
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  fromText,
  LucidEvolution,
  validatorToAddress,
  mintingPolicyToId,
  TxSignBuilder,
  getUniqueTokenName,
} from "@lucid-evolution/lucid";
import { OutputReference, StakingConfig } from "../core/contract.types.js";
import { CreateConfig, Result } from "../core/types.js";
import { fromAddress } from "../index.js";

export const createConfig = async (
  lucid: LucidEvolution,
  config: CreateConfig,
): Promise<Result<{ tx: TxSignBuilder; configTN: string }>> => {
  const network = lucid.config().network;
  const alwaysFails: SpendingValidator = {
    type: "PlutusV2",
    script: config.alwaysFails,
  };
  const alwaysFailsAddr = validatorToAddress(network,alwaysFails);

  if (!config.refScripts.configPolicy.scriptRef)
    return { type: "error", error: new Error("Missing Script Reference") };

  const configPolicy: MintingPolicy = config.refScripts.configPolicy.scriptRef;
  const configPolicyId = mintingPolicyToId(configPolicy);
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
      .pay.ToContract(alwaysFailsAddr, {kind: "inline", value: datum}, assets)
      .mintAssets(assets, redeemerConfigPolicy)
      .readFrom([config.refScripts.configPolicy])
      .complete();

    return { type: "ok", data: { tx: tx, configTN: configTN } };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
