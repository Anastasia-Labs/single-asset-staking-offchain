import {
  SpendingValidator,
  MintingPolicy,
  Data,
  toUnit,
  fromText,
  LucidEvolution,
  validatorToAddress,
  mintingPolicyToId,
  getAddressDetails,
  TxSignBuilder,
} from "@lucid-evolution/lucid";
import {
  StakingNodeAction,
  NodeValidatorAction,
  SetNode,
} from "../core/contract.types.js";
import { RemoveNodeConfig, Result } from "../core/types.js";
import {
  divCeil,
  findOwnNode,
  findPreviousNode,
  mkNodeKeyTN,
  TIME_TOLERANCE_MS,
} from "../index.js";
import { fetchConfigUTxO } from "./fetchConfig.js";

export const removeNode = async (
  lucid: LucidEvolution,
  config: RemoveNodeConfig,
): Promise<Result<TxSignBuilder>> => {
  const network = lucid.config().network;
  config.currentTime ??= Date.now();

  const walletUtxos = await lucid.wallet().getUtxos();

  if (!walletUtxos.length)
    return { type: "error", error: new Error("No utxos in wallet") };

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

  const userAddress = await lucid.wallet().address();
  const userPubKeyHash =
    getAddressDetails(userAddress).paymentCredential?.hash;

  if (!userPubKeyHash)
    return { type: "error", error: new Error("missing PubKeyHash") };

  const nodeUTXOs = config.nodeUTxOs
    ? config.nodeUTxOs
    : await lucid.utxosAt(nodeValidatorAddr);

  const nodeResponse = await findOwnNode(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
    userPubKeyHash,
    nodeUTXOs,
  );

  if (nodeResponse.type == "error") return nodeResponse;
  const node = nodeResponse.data;

  if (config.currentTime > config.endStaking)
    return {
      type: "error",
      error: new Error(
        "Cannot remove node after endStaking. Please claim node instead.",
      ),
    };

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const nodeDatum = Data.from(node.datum!, SetNode);

  const prevNodeResponse = await findPreviousNode(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
    userPubKeyHash,
    nodeUTXOs,
  );

  if (prevNodeResponse.type == "error") return prevNodeResponse;
  const prevNode = prevNodeResponse.data;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const prevNodeDatum = Data.from(prevNode.datum!, SetNode);

  const assets = {
    [toUnit(nodePolicyId, mkNodeKeyTN(userPubKeyHash))]: -1n,
  };

  const newPrevNode: SetNode = {
    key: prevNodeDatum.key,
    next: nodeDatum.next,
    configTN: config.configTN,
  };

  const newPrevNodeDatum = Data.to(newPrevNode, SetNode);

  const redeemerNodePolicy = Data.to(
    {
      PRemove: {
        keyToRemove: userPubKeyHash,
        coveringNode: newPrevNode,
      },
    },
    StakingNodeAction,
  );

  const stakeToken = toUnit(config.stakeCS, fromText(config.stakeTN));
  const redeemerNodeValidator = Data.to("LinkedListAct", NodeValidatorAction);

  const upperBound = config.currentTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currentTime - TIME_TOLERANCE_MS;

  const beforeStakeFreeze = upperBound < config.freezeStake;
  const afterFreezeBeforeEnd =
    lowerBound > config.freezeStake && upperBound < config.endStaking;

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  try {
    if (beforeStakeFreeze) {
      const tx = await lucid
        .newTx()
        .collectFrom([node, prevNode], redeemerNodeValidator)
        .pay.ToContract(
          nodeValidatorAddr,
          { kind : "inline", value: newPrevNodeDatum },
          prevNode.assets,
        )
        .addSignerKey(userPubKeyHash)
        .mintAssets(assets, redeemerNodePolicy)
        .readFrom([
          config.refScripts.nodePolicy,
          config.refScripts.nodeValidator,
          configUTxOResponse.data,
        ])
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
        .pay.ToContract(
          nodeValidatorAddr,
          { kind : "inline", value: newPrevNodeDatum },
          prevNode.assets,
        )
        .pay.ToAddress(config.penaltyAddress, {
          [stakeToken]: penaltyAmount,
        })
        .pay.ToAddress(userAddress, {
          [stakeToken]: balanceAmount,
        })
        .addSignerKey(userPubKeyHash)
        .mintAssets(assets, redeemerNodePolicy)
        .readFrom([
          config.refScripts.nodePolicy,
          config.refScripts.nodeValidator,
          configUTxOResponse.data,
        ])
        .validFrom(lowerBound)
        .validTo(upperBound)
        .complete();

      return { type: "ok", data: tx };
    } else {
      return {
        type: "error",
        error:
          new Error(`Transaction validity range is overlapping staking phases. 
                              Please wait for ${TIME_TOLERANCE_MS / 1_000} seconds before trying
                              to remove node.`),
      };
    }
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
