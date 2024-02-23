import {
  Lucid,
  MintingPolicy,
  toUnit,
} from "@anastasia-labs/lucid-cardano-fork";
import { StakingConfig } from "../core/contract.types.js";
import { FetchConfig, ReadableUTxO, Result } from "../core/types.js";
import { parseSafeDatum } from "../index.js";

export const fetchConfig = async (
  lucid: Lucid,
  config: FetchConfig
): Promise<Result<ReadableUTxO<StakingConfig>>> => {

  if(!config.refScripts.configPolicy.scriptRef)
    return { type: "error", error: new Error("Missing Script Reference") }

  const configPolicy: MintingPolicy = config.refScripts.configPolicy.scriptRef;
  const configPolicyId = lucid.utils.mintingPolicyToId(configPolicy);
  
  const configUTxO = await lucid.utxoByUnit(toUnit(configPolicyId, config.configTN));
  
  const readableConfigUTxO = parseSafeDatum(lucid, configUTxO.datum, StakingConfig);


  if(readableConfigUTxO.type == "right")
    return { type: "ok", data: 
      {
        outRef: {
          txHash: configUTxO.txHash,
          outputIndex: configUTxO.outputIndex,
        },
        datum: readableConfigUTxO.value,
        assets: configUTxO.assets,
      } 
    }
  else
    return { type: "error", error: new Error(readableConfigUTxO.value) };

};
