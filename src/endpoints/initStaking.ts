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
  NODE_ADA,
  PROTOCOL_FEE,
  PROTOCOL_PAYMENT_KEY,
  PROTOCOL_STAKE_KEY,
  RTHOLDER,
  originNodeTokenName,
} from "../core/constants.js";
import {
  StakingNodeAction,
  SetNode,
  TokenHolderMintAction,
} from "../core/contract.types.js";
import { InitStakingConfig, Result } from "../core/types.js";
import { fetchConfigUTxO } from "./fetchConfig.js";
import { sumUtxoAssets } from "../index.js";

export const initStaking = async (
  lucid: Lucid,
  config: InitStakingConfig,
): Promise<Result<TxComplete>> => {
  if (
    !config.refScripts.nodeValidator.scriptRef ||
    !config.refScripts.nodePolicy.scriptRef ||
    !config.refScripts.tokenHolderValidator.scriptRef ||
    !config.refScripts.tokenHolderPolicy.scriptRef
  )
    return { type: "error", error: new Error("Missing Script Reference") };

  const walletUtxos = await lucid.wallet.getUtxos();

  if (!walletUtxos.length)
    return { type: "error", error: new Error("No utxos in wallet") };

  const [initUTxO] = walletUtxos.filter((utxo) => {
    return utxo == config.stakingInitUTXO;
  });

  if (!initUTxO)
    return {
      type: "error",
      error: new Error("Staking Init UTxO not found in wallet"),
    };

  const totalWalletAssets = sumUtxoAssets(walletUtxos);
  const stakeToken = toUnit(config.stakeCS, fromText(config.stakeTN));
  const rewardToken = toUnit(config.rewardCS, fromText(config.rewardTN));

  if (totalWalletAssets[rewardToken] < (1 + PROTOCOL_FEE) * config.rewardAmount)
    return {
      type: "error",
      error: new Error(
        "Wallet does not have enough reward tokens to \
        provide required rewardAmount and protocol fees.",
      ),
    };

  if (totalWalletAssets[stakeToken] < config.minimumStake)
    return {
      type: "error",
      error: new Error(
        "Wallet does not have enough stake tokens to \
        provide required mininum stake for head node.",
      ),
    };

  const nodeValidator: SpendingValidator =
    config.refScripts.nodeValidator.scriptRef;

  const nodeValidatorAddr = lucid.utils.validatorToAddress(nodeValidator);

  const nodePolicy: MintingPolicy = config.refScripts.nodePolicy.scriptRef;
  const nodePolicyId = lucid.utils.mintingPolicyToId(nodePolicy);

  const tokenHolderValidator: SpendingValidator =
    config.refScripts.tokenHolderValidator.scriptRef;
  const tokenHolderValidatorAddr =
    lucid.utils.validatorToAddress(tokenHolderValidator);

  const tokenHolderPolicy: MintingPolicy =
    config.refScripts.tokenHolderPolicy.scriptRef;
  const tokenHolderPolicyId = lucid.utils.mintingPolicyToId(tokenHolderPolicy);

  const rtHolderAsset = toUnit(tokenHolderPolicyId, fromText(RTHOLDER));
  const mintRTHolderAct = Data.to("PMintHolder", TokenHolderMintAction);

  // data PStakingSetNode (s :: S)
  // = PStakingSetNode
  //     ( Term
  //         s
  //         ( PDataRecord
  //             '[ "key" ':= PNodeKey
  //              , "next" ':= PNodeKey
  //              , "configTN" ':= PTokenName
  //              ]
  //         )
  //     )
  const datum = Data.to(
    {
      key: null,
      next: null,
      configTN: config.configTN,
    },
    SetNode,
  );

  const redeemerNodePolicy = Data.to("PInit", StakingNodeAction);

  const configUTxOResponse = await fetchConfigUTxO(lucid, config);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  try {
    const tx = await lucid
      .newTx()
      .collectFrom([config.stakingInitUTXO])
      .payToContract(
        nodeValidatorAddr,
        { inline: datum },
        {
          [toUnit(nodePolicyId, originNodeTokenName)]: 1n,
          lovelace: NODE_ADA,
          [stakeToken]: BigInt(config.minimumStake), // Evey node must have minimum stake commitment
        },
      )
      .mintAssets(
        { [toUnit(nodePolicyId, originNodeTokenName)]: 1n },
        redeemerNodePolicy,
      )
      .payToContract(
        tokenHolderValidatorAddr,
        { inline: Data.to(config.configTN) },
        {
          [rtHolderAsset]: BigInt(1),
          [rewardToken]: BigInt(config.rewardAmount),
        },
      )
      .mintAssets({ [rtHolderAsset]: BigInt(1) }, mintRTHolderAct)
      .payToAddress(
        lucid.utils.credentialToAddress(
          lucid.utils.keyHashToCredential(PROTOCOL_PAYMENT_KEY),
          lucid.utils.keyHashToCredential(PROTOCOL_STAKE_KEY),
        ),
        {
          [rewardToken]: BigInt(config.rewardAmount * PROTOCOL_FEE),
        },
      )
      .readFrom([
        config.refScripts.nodePolicy,
        config.refScripts.tokenHolderPolicy,
        configUTxOResponse.data,
      ])
      .complete();

    return { type: "ok", data: tx };
  } catch (error) {
    if (error instanceof Error) return { type: "error", error: error };

    return { type: "error", error: new Error(`${JSON.stringify(error)}`) };
  }
};
