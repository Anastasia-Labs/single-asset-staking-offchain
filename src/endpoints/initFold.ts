import {
  Lucid,
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  TxComplete,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  cFold,
  originNodeTokenName,
  TIME_TOLERANCE_MS,
} from "../core/constants.js";
import { FoldDatum, FoldMintAct, SetNode } from "../core/contract.types.js";
import { InitFoldConfig, Result } from "../core/types.js";
import { fromAddress } from "../index.js";
import { fetchConfigUTxO } from "./fetchConfig.js";

export const initFold = async (
  lucid: Lucid,
  config: InitFoldConfig,
): Promise<Result<TxComplete>> => {
  config.currentTime ??= Date.now();

  const foldValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.foldValidator,
  };

  const foldValidatorAddr = lucid.utils.validatorToAddress(foldValidator);

  const foldPolicy: MintingPolicy = {
    type: "PlutusV2",
    script: config.scripts.foldPolicy,
  };

  const foldPolicyId = lucid.utils.mintingPolicyToId(foldPolicy);

  const nodePolicy: MintingPolicy = {
    type: "PlutusV2",
    script: config.scripts.nodePolicy,
  };

  if (
    !config.refScripts.nodeValidator.scriptRef ||
    !config.refScripts.nodePolicy.scriptRef
  )
    return { type: "error", error: new Error("Missing Script Reference") };
  const nodeValidator: SpendingValidator =
    config.refScripts.nodeValidator.scriptRef;

  const [headNodeUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress(nodeValidator),
    toUnit(lucid.utils.mintingPolicyToId(nodePolicy), originNodeTokenName),
  );

  if (!headNodeUTxO || !headNodeUTxO.datum)
    return { type: "error", error: new Error("missing nodeRefInputUTxO") };

  const currentNode = Data.from(headNodeUTxO.datum, SetNode);

  const datum = Data.to(
    {
      currNode: currentNode,
      staked: 0n,
      owner: fromAddress(await lucid.wallet.address()), //NOTE: owner is not being used in fold minting or validator
    },
    FoldDatum,
  );

  const redeemerFoldPolicy = Data.to("MintFold", FoldMintAct);

  const assets = {
    [toUnit(foldPolicyId, cFold)]: 1n,
  };

  const upperBound = config.currentTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currentTime - TIME_TOLERANCE_MS;

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  try {
    const tx = await lucid
      .newTx()
      .readFrom([headNodeUTxO])
      .payToContract(foldValidatorAddr, { inline: datum }, assets)
      .mintAssets(assets, redeemerFoldPolicy)
      .compose(
        config.refScripts?.foldPolicy
          ? lucid.newTx().readFrom([config.refScripts.foldPolicy])
          : lucid.newTx().attachMintingPolicy(foldPolicy),
      )
      .validFrom(lowerBound)
      .validTo(upperBound)
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
