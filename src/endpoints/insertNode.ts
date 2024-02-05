import {
  Lucid,
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  TxComplete,
  fromText,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  StakingNodeAction,
  NodeValidatorAction,
  SetNode,
} from "../core/contract.types.js";
import { InsertNodeConfig, Result } from "../core/types.js";
import { NODE_ADA, mkNodeKeyTN, TIME_TOLERANCE_MS, findCoveringNode } from "../index.js";

export const insertNode = async (
  lucid: Lucid,
  config: InsertNodeConfig
): Promise<Result<TxComplete>> => {
  config.currentTime ??= Date.now();

  const walletUtxos = await lucid.wallet.getUtxos();

  if (!walletUtxos.length)
    return { type: "error", error: new Error("No utxos in wallet") };

  if(config.toStake < config.minimumStake)
    return { type: "error", error: new Error("toStake cannot be less than minimumStake") };

  if(config.currentTime > config.freezeStake)
    return { type: "error", error: new Error("Stake has been frozen") }

  const nodeValidator: SpendingValidator = {
    type: "PlutusV2",
    script: config.scripts.nodeValidator,
  };

  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const nodePolicy: MintingPolicy = {
    type: "PlutusV2",
    script: config.scripts.nodePolicy,
  };

  const nodePolicyId = lucid.utils.mintingPolicyToId(nodePolicy);

  const userKey = lucid.utils.getAddressDetails(await lucid.wallet.address())
    .paymentCredential?.hash;

  if (!userKey)
    return { type: "error", error: new Error("missing PubKeyHash") };

  const nodeUTXOs = config.nodeUTxOs
    ? config.nodeUTxOs
    : await lucid.utxosAt(nodeValidatorAddr);
  // console.log(nodeUTXOs)

  const coveringNode = findCoveringNode(nodeUTXOs, userKey);

  if(coveringNode.type == "error")
    return coveringNode;

  // datum is already checked in fn findCoveringNode
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const coveringNodeDatum = Data.from(coveringNode.data.datum!, SetNode);

  const prevNodeDatum = Data.to(
    {
      key: coveringNodeDatum.key,
      next: userKey,
    },
    SetNode
  );

  const nodeDatum = Data.to(
    {
      key: userKey,
      next: coveringNodeDatum.next,
    },
    SetNode
  );

  const redeemerNodePolicy = Data.to(
    {
      PInsert: {
        keyToInsert: userKey,
        coveringNode: coveringNodeDatum,
      },
    },
    StakingNodeAction
  );

  const redeemerNodeValidator = Data.to("LinkedListAct", NodeValidatorAction);

  const assets = {
    [toUnit(nodePolicyId, mkNodeKeyTN(userKey))]: 1n,
  };

  const upperBound = config.currentTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currentTime - TIME_TOLERANCE_MS;

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([coveringNode.data], redeemerNodeValidator)
      .compose(
        config.refScripts?.nodeValidator
          ? lucid.newTx().readFrom([config.refScripts.nodeValidator])
          : lucid.newTx().attachSpendingValidator(nodeValidator)
      )
      .payToContract(
        nodeValidatorAddr,
        { inline: prevNodeDatum },
        coveringNode.data.assets
      )
      .payToContract(
        nodeValidatorAddr,
        { inline: nodeDatum },
        { ...assets, 
          [toUnit(config.stakeCS, fromText(config.stakeTN))]: BigInt(config.toStake),
          lovelace: NODE_ADA 
        }
      )
      .addSignerKey(userKey)
      .mintAssets(assets, redeemerNodePolicy)
      .compose(
        config.refScripts?.nodePolicy
          ? lucid.newTx().readFrom([config.refScripts.nodePolicy])
          : lucid.newTx().attachMintingPolicy(nodePolicy)
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
