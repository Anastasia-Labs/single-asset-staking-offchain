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
} from "../core/contract.types.js";
import { RemoveNodeConfig, Result } from "../core/types.js";
import {
  NODE_ADA,
  mkNodeKeyTN,
  TIME_TOLERANCE_MS,
  findOwnNode,
} from "../index.js";
import { fetchConfigUTxO } from "./fetchConfig.js";

export const claimNode = async (
  lucid: Lucid,
  config: RemoveNodeConfig,
): Promise<Result<TxComplete>> => {
  config.currentTime ??= Date.now();

  const walletUtxos = await lucid.wallet.getUtxos();

  if (!walletUtxos.length)
    return { type: "error", error: new Error("No utxos in wallet") };

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

  const userAddress = await lucid.wallet.address();
  const userPubKeyHash =
    lucid.utils.getAddressDetails(userAddress).paymentCredential?.hash;

  if (!userPubKeyHash)
    return { type: "error", error: new Error("missing PubKeyHash") };

  const node = await findOwnNode(
    lucid,
    config.configTN,
    nodeValidatorAddr,
    nodePolicyId,
    userPubKeyHash,
  );

  if (node.type == "error") return node;

  // After rewards fold is completed for a node, its lovelace value is MIN_ADA (NODE_ADA - FOLDING_FEE)
  if (
    config.currentTime <= config.endStaking ||
    node.data.assets["lovelace"] == NODE_ADA
  )
    return {
      type: "error",
      error: new Error("Cannot claim node before rewards are processed"),
    };

  const upperBound = config.currentTime + TIME_TOLERANCE_MS;
  const lowerBound = config.currentTime - TIME_TOLERANCE_MS;

  const afterEndStaking = lowerBound > config.endStaking;

  const assets = {
    [toUnit(nodePolicyId, mkNodeKeyTN(userPubKeyHash))]: -1n,
  };

  const redeemerNodePolicy = Data.to(
    {
      PClaim: {
        keyToRemove: userPubKeyHash,
      },
    },
    StakingNodeAction,
  );

  const redeemerNodeValidator = Data.to("LinkedListAct", NodeValidatorAction);

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  try {
    if (afterEndStaking) {
      const tx = await lucid
        .newTx()
        .collectFrom([node.data], redeemerNodeValidator)
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
                              to claim node.`),
      };
    }
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
