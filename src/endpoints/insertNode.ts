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
import {
  NODE_ADA,
  mkNodeKeyTN,
  TIME_TOLERANCE_MS,
  findCoveringNode,
} from "../index.js";
import { fetchConfigUTxO } from "./fetchConfig.js";

export const insertNode = async (
  lucid: Lucid,
  config: InsertNodeConfig,
): Promise<Result<TxComplete>> => {
  config.currentTime ??= Date.now();

  const walletUtxos = await lucid.wallet.getUtxos();

  if (!walletUtxos.length)
    return { type: "error", error: new Error("No utxos in wallet") };

  if (config.toStake < config.minimumStake)
    return {
      type: "error",
      error: new Error("toStake cannot be less than minimumStake"),
    };

  if (config.currentTime > config.freezeStake)
    return { type: "error", error: new Error("Stake has been frozen") };

  if (
    !config.refScripts.nodeValidator.scriptRef ||
    !config.refScripts.nodePolicy.scriptRef
  )
    return { type: "error", error: new Error("Missing Script Reference") };

  const nodeValidator: SpendingValidator =
    config.refScripts.nodeValidator.scriptRef;
  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const nodePolicy: MintingPolicy = config.refScripts.nodePolicy.scriptRef;
  const nodePolicyId = lucid.utils.mintingPolicyToId(nodePolicy);

  const userKey = lucid.utils.getAddressDetails(await lucid.wallet.address())
    .paymentCredential?.hash;

  if (!userKey)
    return { type: "error", error: new Error("missing PubKeyHash") };

  const nodeUTXOs = config.nodeUTxOs
    ? config.nodeUTxOs
    : await lucid.utxosAt(nodeValidatorAddr);

  const coveringNode = await findCoveringNode(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
    userKey,
    nodeUTXOs,
  );

  if (coveringNode.type == "error") return coveringNode;

  // datum is already checked in fn findCoveringNode
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const coveringNodeDatum = Data.from(coveringNode.data.datum!, SetNode);

  const prevNodeDatum = Data.to(
    {
      key: coveringNodeDatum.key,
      next: userKey,
      configTN: config.configTN,
    },
    SetNode,
  );

  const nodeDatum = Data.to(
    {
      key: userKey,
      next: coveringNodeDatum.next,
      configTN: config.configTN,
    },
    SetNode,
  );

  const redeemerNodePolicy = Data.to(
    {
      PInsert: {
        keyToInsert: userKey,
        coveringNode: coveringNodeDatum,
      },
    },
    StakingNodeAction,
  );

  const redeemerNodeValidator = Data.to("LinkedListAct", NodeValidatorAction);

  const assets = {
    [toUnit(nodePolicyId, mkNodeKeyTN(userKey))]: 1n,
  };

  const upperBound = config.currentTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currentTime - TIME_TOLERANCE_MS;

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([coveringNode.data], redeemerNodeValidator)
      .payToContract(
        nodeValidatorAddr,
        { inline: prevNodeDatum },
        coveringNode.data.assets,
      )
      .payToContract(
        nodeValidatorAddr,
        { inline: nodeDatum },
        {
          ...assets,
          [toUnit(config.stakeCS, fromText(config.stakeTN))]: BigInt(
            config.toStake,
          ),
          lovelace: NODE_ADA,
        },
      )
      .addSignerKey(userKey)
      .mintAssets(assets, redeemerNodePolicy)
      .readFrom([
        config.refScripts.nodeValidator,
        config.refScripts.nodePolicy,
        configUTxOResponse.data,
      ])
      .validFrom(lowerBound)
      .validTo(upperBound)
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
