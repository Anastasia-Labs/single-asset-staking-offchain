
import {
  Lucid,
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  TxComplete,
  Assets,
} from "@anastasia-labs/lucid-cardano-fork";
import { StakingNodeAction, NodeValidatorAction, SetNode } from "../core/contract.types.js";
import { InsertNodeConfig, Result } from "../core/types.js";
import { mkNodeKeyTN } from "../index.js";

export const modifyNode = async (
  lucid: Lucid,
  config: InsertNodeConfig
): Promise<Result<TxComplete>> => {

  const nodeValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.nodeValidator,
  };

  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const userKey = lucid.utils.getAddressDetails(await lucid.wallet.address())
    .paymentCredential?.hash;

  if (!userKey)
    return { type: "error", error: new Error("missing PubKeyHash") };

  const nodeUTXOs = config.nodeUTxOs
    ? config.nodeUTxOs
    : await lucid.utxosAt(nodeValidatorAddr);
  // console.log(nodeUTXOs)

  //TODO: move this to utils
  const ownNode = nodeUTXOs.find((utxo) => {
    if (utxo.datum){
      const nodeDat = Data.from(utxo.datum, SetNode)
      return nodeDat.key == userKey 
    }
  });
  // console.log("found covering node ", coveringNode)

  if (!ownNode || !ownNode.datum)
    return { type: "error", error: new Error("missing ownNode") };

  const redeemerNodeValidator = Data.to("ModifyStake",NodeValidatorAction)

  const newNodeAssets : Assets = {}
  Object.keys(ownNode.assets).forEach((unit) => newNodeAssets[unit] = ownNode.assets[unit]);
  newNodeAssets['lovelace'] = newNodeAssets['lovelace'] + BigInt(config.amountLovelace)

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([ownNode], redeemerNodeValidator)
      .compose(
        config.refScripts?.nodeValidator
          ? lucid.newTx().readFrom([config.refScripts.nodeValidator])
          : lucid.newTx().attachSpendingValidator(nodeValidator)
      )
      .payToContract(
        nodeValidatorAddr,
        { inline: ownNode.datum },
        newNodeAssets
      )
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
