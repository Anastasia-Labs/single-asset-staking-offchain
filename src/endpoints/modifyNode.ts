import {
  SpendingValidator,
  Data,
  toUnit,
  fromText,
  MintingPolicy,
  LucidEvolution,
  getAddressDetails,
  validatorToAddress,
  mintingPolicyToId,
  TxSignBuilder,
} from "@lucid-evolution/lucid";
import { NodeValidatorAction } from "../core/contract.types.js";
import { InsertNodeConfig, Result } from "../core/types.js";
import { TIME_TOLERANCE_MS, findOwnNode } from "../index.js";
import { fetchConfigUTxO } from "./fetchConfig.js";

export const modifyNode = async (
  lucid: LucidEvolution,
  config: InsertNodeConfig,
): Promise<Result<TxSignBuilder>> => {
  const network = lucid.config().network;

  config.currentTime ??= Date.now();

  const walletUtxos = await lucid.wallet().getUtxos();

  if (!walletUtxos.length)
    return { type: "error", error: new Error("No utxos in wallet") };

  const userAddress = await lucid.wallet().address();
  const userKey =
    getAddressDetails(userAddress).paymentCredential?.hash;

  if (!userKey)
    return { type: "error", error: new Error("missing PubKeyHash") };

  if (config.toStake < config.minimumStake)
    return {
      type: "error",
      error: new Error("toStake cannot be less than minimumStake"),
    };

  if (config.currentTime > config.freezeStake)
    return { type: "error", error: new Error("Stake has been frozen") };

  const upperBound = config.currentTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currentTime - TIME_TOLERANCE_MS;

  if (upperBound >= config.freezeStake)
    return {
      type: "error",
      error: new Error(`Transaction validity range has crossed freezeStake. 
                        Creating a stake modification transaction is allowed ${TIME_TOLERANCE_MS / 1_000} seconds before freezeStake.`),
    };

  if (
    !config.refScripts.nodeValidator.scriptRef ||
    !config.refScripts.nodePolicy.scriptRef
  )
    return { type: "error", error: new Error("Missing Script Reference") };
  const nodeValidator: SpendingValidator =
    config.refScripts.nodeValidator.scriptRef;
  const nodeValidatorAddr = validatorToAddress(network,nodeValidator);

  const nodePolicy: MintingPolicy = config.refScripts.nodePolicy.scriptRef;
  const nodePolicyId = mintingPolicyToId(nodePolicy);

  const ownNode = await findOwnNode(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
    userKey,
    config.nodeUTxOs,
  );

  if (ownNode.type == "error" || !ownNode.data.datum)
    return { type: "error", error: new Error("missing ownNode") };

  const redeemerNodeValidator = Data.to("ModifyStake", NodeValidatorAction);

  const stakeToken = toUnit(config.stakeCS, fromText(config.stakeTN));
  const oldStake = ownNode.data.assets[stakeToken];
  const newStake = BigInt(config.toStake);
  const differenceAmount = oldStake - newStake;

  if (differenceAmount == 0n)
    return {
      type: "error",
      error: new Error("New stake is equal to old stake"),
    };

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([ownNode.data], redeemerNodeValidator)
      .readFrom([config.refScripts.nodeValidator, configUTxOResponse.data])
      .pay.ToContract(
        nodeValidatorAddr,
        { kind : "inline", value : ownNode.data.datum },
        { ...ownNode.data.assets, [stakeToken]: newStake }, // Only updating the stakeToken to new stake
      )
      .addSignerKey(userKey)
      .validFrom(lowerBound)
      .validTo(upperBound)
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
