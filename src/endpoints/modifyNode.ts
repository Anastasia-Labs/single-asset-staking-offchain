
import {
  Lucid,
  SpendingValidator,
  Data,
  toUnit,
  TxComplete,
  fromText,
} from "@anastasia-labs/lucid-cardano-fork";
import { NodeValidatorAction } from "../core/contract.types.js";
import { InsertNodeConfig, Result } from "../core/types.js";
import { TIME_TOLERANCE_MS, findOwnNode } from "../index.js";

export const modifyNode = async (
  lucid: Lucid,
  config: InsertNodeConfig
): Promise<Result<TxComplete>> => {
  config.currentTime ??= Date.now();

  const walletUtxos = await lucid.wallet.getUtxos();

  if (!walletUtxos.length)
    return { type: "error", error: new Error("No utxos in wallet") };

  const userAddress = await lucid.wallet.address();
  const userKey = lucid.utils.getAddressDetails(userAddress)
    .paymentCredential?.hash;

  if (!userKey)
    return { type: "error", error: new Error("missing PubKeyHash") };

  if(config.toStake < config.minimumStake)
    return { type: "error", error: new Error("toStake cannot be less than minimumStake") };

  if(config.currentTime > config.freezeStake)
    return { type: "error", error: new Error("Stake has been frozen") }

  const nodeValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.nodeValidator,
  };

  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const nodeUTXOs = config.nodeUTxOs
    ? config.nodeUTxOs
    : await lucid.utxosAt(nodeValidatorAddr);

  const ownNode = findOwnNode(nodeUTXOs, userKey);

  if (ownNode.type == "error" || !ownNode.data.datum)
    return { type: "error", error: new Error("missing ownNode") };

  const redeemerNodeValidator = Data.to("ModifyStake", NodeValidatorAction)

  const stakeToken = toUnit(config.stakeCS, fromText(config.stakeTN));
  const oldStake = ownNode.data.assets[stakeToken];
  const newStake = BigInt(config.toStake);
  const differenceAmount = oldStake - newStake; 
  
  if(differenceAmount == 0n)
    return { type: "error", error: new Error("New stake is equal to old stake")}

  const upperBound = (config.currentTime + TIME_TOLERANCE_MS);
  const lowerBound = (config.currentTime - TIME_TOLERANCE_MS);

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([ownNode.data], redeemerNodeValidator)
      .compose(
        config.refScripts?.nodeValidator
          ? lucid.newTx().readFrom([config.refScripts.nodeValidator])
          : lucid.newTx().attachSpendingValidator(nodeValidator)
      )
      .payToContract(
        nodeValidatorAddr,
        { inline: ownNode.data.datum },
        { ...ownNode.data.assets, [stakeToken]: newStake } // Only updating the stakeToken to new stake
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
