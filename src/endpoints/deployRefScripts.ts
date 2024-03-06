import {
  Lucid,
  SpendingValidator,
  toUnit,
  fromText,
  Script,
} from "@anastasia-labs/lucid-cardano-fork";
import { Deploy, DeployRefScriptsConfig, Result } from "../core/types.js";

export const deployRefScripts = async (
  lucid: Lucid,
  config: DeployRefScriptsConfig,
): Promise<Result<Deploy>> => {
  const walletUtxos = await lucid.wallet.getUtxos();

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

  const alwaysFailsAddr = lucid.utils.validatorToAddress(alwaysFailsValidator);

  const deployKey = lucid.utils.getAddressDetails(await lucid.wallet.address())
    .paymentCredential?.hash;

  if (!deployKey)
    return { type: "error", error: new Error("missing PubKeyHash") };

  const deployPolicy = lucid.utils.nativeScriptFromJson({
    type: "all",
    scripts: [
      { type: "sig", keyHash: deployKey },
      {
        type: "before",
        // 30 minutes interval to create all Reference Script UTxOs
        slot: lucid.utils.unixTimeToSlot(config.currentTime + 30 * 60 * 1000),
      },
    ],
  });

  const deployPolicyId = lucid.utils.mintingPolicyToId(deployPolicy);

  try {
    const tx = await lucid
      .newTx()
      .attachMintingPolicy(deployPolicy)
      .mintAssets({
        [toUnit(deployPolicyId, fromText(config.name))]: 1n,
      })
      .payToAddressWithData(
        alwaysFailsAddr,
        { scriptRef: script },
        { [toUnit(deployPolicyId, fromText(config.name))]: 1n },
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
