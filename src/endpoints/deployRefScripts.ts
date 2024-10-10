import {
  SpendingValidator,
  toUnit,
  fromText,
  Script,
  LucidEvolution,
  validatorToAddress,
  getAddressDetails,
  nativeScriptFromJson,
  unixTimeToSlot,
  mintingPolicyToId,
  Data,
} from "@lucid-evolution/lucid";
import { Deploy, DeployRefScriptsConfig, Result } from "../core/types.js";

export const deployRefScripts = async (
  lucid: LucidEvolution,
  config: DeployRefScriptsConfig,
): Promise<Result<Deploy>> => {
  const network = lucid.config().network;
  const walletUtxos = await lucid.wallet().getUtxos();

  if (!walletUtxos.length)
    return { type: "error", error: new Error("No utxos in wallet") };

  const script: Script = {
    type: "PlutusV2",
    script: config.script,
  };

  const alwaysFailsValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.alwaysFails,
  };

  const alwaysFailsAddr = validatorToAddress(network,alwaysFailsValidator);

  const deployKey = getAddressDetails(await lucid.wallet().address())
    .paymentCredential?.hash;

  if (!deployKey)
    return { type: "error", error: new Error("missing PubKeyHash") };

  const deployPolicy = nativeScriptFromJson({
    type: "all",
    scripts: [
      { type: "sig", keyHash: deployKey },
      {
        type: "before",
        // 30 minutes interval to create all Reference Script UTxOs
        slot: unixTimeToSlot(network,config.currentTime + 30 * 60 * 1000),
      },
    ],
  });

  const deployPolicyId = mintingPolicyToId(deployPolicy);

  try {
    const tx = await lucid
      .newTx()
      .attach.MintingPolicy(deployPolicy)
      .mintAssets({
        [toUnit(deployPolicyId, fromText(config.name))]: 1n,
      })
      .pay.ToAddressWithData(
        alwaysFailsAddr,
        { kind : "inline", value : Data.void()},
        { [toUnit(deployPolicyId, fromText(config.name))]: 1n },
        script
        //{ scriptRef: script },
      )
      .validTo(config.currentTime + 29 * 60 * 1000)
      .complete();

    return {
      type: "ok",
      data: {
        tx: tx,
        deployPolicyId: deployPolicyId,
      },
    };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
