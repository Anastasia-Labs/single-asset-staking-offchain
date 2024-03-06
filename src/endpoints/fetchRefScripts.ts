import { Lucid, fromText, toUnit } from "@anastasia-labs/lucid-cardano-fork";
import { FetchRefScriptsConfig, RefScripts, Result } from "../core/types.js";
import { REF_SCRIPT_TNs } from "../index.js";

export const fetchRefScripts = async (
  lucid: Lucid,
  config: FetchRefScriptsConfig,
): Promise<Result<RefScripts>> => {
  const alwaysFailsAddr = lucid.utils.validatorToAddress({
    type: "PlutusV2",
    script: config.alwaysFails,
  });

  // "as unknown as RefScripts" used as a hack to avoid linting error of missing
  // fields for RefScripts object
  const refScripts = {} as unknown as RefScripts;
  type RefScriptsKey = keyof typeof refScripts;

  try {
    for (const [key, value] of Object.entries(REF_SCRIPT_TNs)) {
      const [utxo] = await lucid.utxosAtWithUnit(
        alwaysFailsAddr,
        toUnit(config.deployPolicyId, fromText(value)),
      );

      refScripts[key as RefScriptsKey] = utxo;
    }

    return { type: "ok", data: refScripts };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
