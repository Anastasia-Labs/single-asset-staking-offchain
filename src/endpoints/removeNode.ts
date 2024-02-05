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
import { RemoveNodeConfig, Result } from "../core/types.js";
import { divCeil, mkNodeKeyTN, TIME_TOLERANCE_MS } from "../index.js";

export const removeNode = async (
  lucid: Lucid,
  config: RemoveNodeConfig
): Promise<Result<TxComplete>> => {
  config.currentTime ??= Date.now();

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

  const userAddress = await lucid.wallet.address();
  const userPubKeyHash = lucid.utils.getAddressDetails(userAddress).paymentCredential?.hash;

  if (!userPubKeyHash)
    return { type: "error", error: new Error("missing PubKeyHash") };

  const nodeUTXOs = config.nodeUTxOs
    ? config.nodeUTxOs
    : await lucid.utxosAt(nodeValidatorAddr);

  const node = nodeUTXOs.find((value) => {
    if (value.datum) {
      const datum = Data.from(value.datum, SetNode);
      return datum.key !== null && datum.key == userPubKeyHash;
    }
  });

  if (!node || !node.datum)
    return { type: "error", error: new Error("missing node") };

  if (config.currentTime > config.endStaking)
    return { type: "error", error: new Error("Cannot remove node after endStaking. Please claim node instead.")}

  const nodeDatum = Data.from(node.datum, SetNode);

  const prevNode = nodeUTXOs.find((value) => {
    if (value.datum) {
      const datum = Data.from(value.datum, SetNode);
      return datum.next !== null && datum.next == userPubKeyHash;
    }
  });

  if (!prevNode || !prevNode.datum)
    return { type: "error", error: new Error("missing prevNode") };

  const prevNodeDatum = Data.from(prevNode.datum, SetNode);

  const assets = {
    [toUnit(nodePolicyId, mkNodeKeyTN(userPubKeyHash))]: -1n,
  };

  const newPrevNode: SetNode = {
    key: prevNodeDatum.key,
    next: nodeDatum.next,
  };

  const newPrevNodeDatum = Data.to(newPrevNode, SetNode);

  const redeemerNodePolicy = Data.to(
    {
      PRemove: {
        keyToRemove: userPubKeyHash,
        coveringNode: newPrevNode,
      },
    },
    StakingNodeAction
  );
  
  const stakeToken = toUnit(config.stakeCS, fromText(config.stakeTN));
  const redeemerNodeValidator = Data.to("LinkedListAct", NodeValidatorAction);

  const upperBound = (config.currentTime + TIME_TOLERANCE_MS)
  const lowerBound = (config.currentTime - TIME_TOLERANCE_MS)

  const beforeStakeFreeze = upperBound < config.freezeStake;
  const afterFreezeBeforeEnd = lowerBound > config.freezeStake && upperBound < config.endStaking;

  try {
    if (beforeStakeFreeze) {

      const tx = await lucid
        .newTx()
        .collectFrom([node, prevNode], redeemerNodeValidator)
        .compose(
          config.refScripts?.nodeValidator
            ? lucid.newTx().readFrom([config.refScripts.nodeValidator])
            : lucid.newTx().attachSpendingValidator(nodeValidator)
        )
        .payToContract(
          nodeValidatorAddr,
          { inline: newPrevNodeDatum },
          prevNode.assets
        )
        .addSignerKey(userPubKeyHash)
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

    } else if (afterFreezeBeforeEnd) {

      const penaltyAmount = divCeil(node.assets[stakeToken], 4n);
      const balanceAmount = node.assets[stakeToken] - penaltyAmount;

      const tx = await lucid
        .newTx()
        .collectFrom([node, prevNode], redeemerNodeValidator)
        .compose(
          config.refScripts?.nodeValidator
            ? lucid.newTx().readFrom([config.refScripts.nodeValidator])
            : lucid.newTx().attachSpendingValidator(nodeValidator)
        )
        .payToContract(
          nodeValidatorAddr,
          { inline: newPrevNodeDatum },
          prevNode.assets
        )
        .payToAddress(config.penaltyAddress, {
          [stakeToken]: penaltyAmount,
        })
        .payToAddress(userAddress, {
          [stakeToken]: balanceAmount
        })
        .addSignerKey(userPubKeyHash)
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

    } else {
      return { type: "error", 
            error: new Error(`Transaction validity range is overlapping staking phases. 
                              Please wait for ${TIME_TOLERANCE_MS/1_000} seconds before trying
                              to remove node.`)
        }
    }
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
