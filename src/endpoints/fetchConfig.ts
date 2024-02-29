import {
  Lucid,
  MintingPolicy,
  UTxO,
  toText,
  toUnit,
} from "@anastasia-labs/lucid-cardano-fork";
import { StakingConfig } from "../core/contract.types.js";
import { FetchConfig, ReadableUTxO, Result } from "../core/types.js";
import { parseSafeDatum } from "../index.js";

export const fetchConfigReadableUTxO = async (
  lucid: Lucid,
  config: FetchConfig,
): Promise<Result<ReadableUTxO<StakingConfig>>> => {
  try {
    const configUTxOResponse = await fetchConfigUTxO(lucid, config);

    if (configUTxOResponse.type == "error") return configUTxOResponse;

    const configUTxO = configUTxOResponse.data;
    const readableConfigUTxO = parseSafeDatum(configUTxO.datum, StakingConfig);

    if (readableConfigUTxO.type == "right") {
      const stakingConfig = readableConfigUTxO.value;
      stakingConfig.stakeTN = toText(stakingConfig.stakeTN);
      stakingConfig.rewardTN = toText(stakingConfig.rewardTN);

      return {
        type: "ok",
        data: {
          outRef: {
            txHash: configUTxO.txHash,
            outputIndex: configUTxO.outputIndex,
          },
          datum: stakingConfig,
          assets: configUTxO.assets,
        },
      };
    } else return { type: "error", error: new Error(readableConfigUTxO.value) };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};

export const fetchConfigUTxO = async (
  lucid: Lucid,
  config: FetchConfig,
): Promise<Result<UTxO>> => {
  if (!config.refScripts.configPolicy.scriptRef)
    return { type: "error", error: new Error("Missing Script Reference") };

  const configPolicy: MintingPolicy = config.refScripts.configPolicy.scriptRef;
  const configPolicyId = lucid.utils.mintingPolicyToId(configPolicy);

  try {
    const configUTxO = await lucid.utxoByUnit(
      toUnit(configPolicyId, config.configTN),
    );

    return { type: "ok", data: configUTxO };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
