import {
  Lucid,
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  TxComplete,
} from "@anastasia-labs/lucid-cardano-fork";
import {
  StakingNodeAction,
  NodeValidatorAction,
  SetNode,
} from "../core/contract.types.js";
import { InsertNodeConfig, Result } from "../core/types.js";
import { NODE_ADA, mkNodeKeyTN, TIME_TOLERANCE_MS, MIN_COMMITMENT_ADA } from "../index.js";

export const insertNode = async (
  lucid: Lucid,
  config: InsertNodeConfig
): Promise<Result<TxComplete>> => {
  config.currenTime ??= Date.now();

  const walletUtxos = await lucid.wallet.getUtxos();

  if (!walletUtxos.length)
    return { type: "error", error: new Error("No utxos in wallet") };

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

  //TODO: move this to utils
  const coveringNode = nodeUTXOs.find((value) => {
    if (value.datum) {
      const datum = Data.from(value.datum, SetNode);
      return (
        (datum.key == null || datum.key < userKey) &&
        (datum.next == null || userKey < datum.next)
      );
    }
  });
  // console.log("found covering node ", coveringNode)

  if (!coveringNode || !coveringNode.datum)
    return { type: "error", error: new Error("missing coveringNode") };

  const coveringNodeDatum = Data.from(coveringNode.datum, SetNode);

  const prevNodeDatum = Data.to(
    {
      key: coveringNodeDatum.key,
      next: userKey,
    },
    SetNode
  );
  // const prevNodeDatum = Data.to(
  //   new Constr(0, [new Constr(1, []), new Constr(0, [userKey])])
  // );

  const nodeDatum = Data.to(
    {
      key: userKey,
      next: coveringNodeDatum.next,
    },
    SetNode
  );
  // const nodeDatum = Data.to(
  //   new Constr(0, [new Constr(0, [userKey]), new Constr(1, [])])
  // );

  //TODO: Add Node Action
  const redeemerNodePolicy = Data.to(
    {
      PInsert: {
        keyToInsert: userKey,
        coveringNode: coveringNodeDatum,
      },
    },
    StakingNodeAction
  );
  // console.log(JSON.stringify(Data.from(redeemerNodePolicy),undefined,2))

  // Constr 2 [B "\228\244\204\173\237$\135\b\248\200,\168Q6\158\175\253'\210\207\170\231\CAN\DEL\200\\H\177",Constr 0 [Constr 1 [],Constr 1 []]]

  // const redeemerNodePolicy = Data.to(
  //   new Constr(2, [
  //     userKey,
  //     new Constr(0, [new Constr(1, []), new Constr(1, [])]),
  //   ])
  // );

  const redeemerNodeValidator = Data.to("LinkedListAct", NodeValidatorAction);
  // const redeemerNodeValidator = Data.to(new Constr(0, []));

  const assets = {
    [toUnit(nodePolicyId, mkNodeKeyTN(userKey))]: 1n,
  };

  const correctAmount = BigInt(config.amountLovelace) + MIN_COMMITMENT_ADA;

  const upperBound = config.currenTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currenTime - TIME_TOLERANCE_MS;

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([coveringNode], redeemerNodeValidator)
      .compose(
        config.refScripts?.nodeValidator
          ? lucid.newTx().readFrom([config.refScripts.nodeValidator])
          : lucid.newTx().attachSpendingValidator(nodeValidator)
      )
      // .attachSpendingValidator(nodeValidator)
      .payToContract(
        nodeValidatorAddr,
        { inline: prevNodeDatum },
        coveringNode.assets
      )
      .payToContract(
        nodeValidatorAddr,
        { inline: nodeDatum },
        { ...assets, lovelace: correctAmount }
      )
      .addSignerKey(userKey)
      .mintAssets(assets, redeemerNodePolicy)
      // .attachMintingPolicy(nodePolicy)
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
