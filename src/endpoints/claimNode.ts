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
import { RemoveNodeConfig, Result } from "../core/types.js";
import { NODE_ADA, mkNodeKeyTN, TIME_TOLERANCE_MS } from "../index.js";

export const claimNode = async (
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

  // After rewards fold is completed for a node, its lovelace value is MIN_ADA (NODE_ADA - FOLDING_FEE)
  if (config.currentTime <= config.endStaking 
      || node.assets["lovelace"] == NODE_ADA)
    return { type: "error", error: new Error("Cannot claim node before rewards are processed")}

  const upperBound = (config.currentTime + TIME_TOLERANCE_MS)
  const lowerBound = (config.currentTime - TIME_TOLERANCE_MS)

  const afterEndStaking = lowerBound > config.endStaking;

  const assets = {
    [toUnit(nodePolicyId, mkNodeKeyTN(userPubKeyHash))]: -1n,
  };
  
  const redeemerNodePolicy = Data.to({
    PClaim: {
      keyToRemove: userPubKeyHash
    }
  }, StakingNodeAction);
  
  const redeemerNodeValidator = Data.to("LinkedListAct", NodeValidatorAction);

  try {
    if(afterEndStaking) {
        
      const tx = await lucid
        .newTx()
        .collectFrom([node], redeemerNodeValidator)
        .compose(
          config.refScripts?.nodeValidator
            ? lucid.newTx().readFrom([config.refScripts.nodeValidator])
            : lucid.newTx().attachSpendingValidator(nodeValidator)
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

    } else {
      return { type: "error", 
            error: new Error(`Transaction validity range is overlapping staking phases. 
                              Please wait for ${TIME_TOLERANCE_MS/1_000} seconds before trying
                              to claim node.`)
        }
    }
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
