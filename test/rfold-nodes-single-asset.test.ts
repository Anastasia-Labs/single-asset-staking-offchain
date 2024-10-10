import {
  initFold,
  InitFoldConfig,
  initStaking,
  InitStakingConfig,
  initRewardFold,
  InitRewardFoldConfig,
  multiFold,
  MultiFoldConfig,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  replacer,
  TWENTY_FOUR_HOURS_MS,
  utxosAtScript,
  SetNode,
  reclaimReward,
  RemoveNodeConfig,
  RewardFoldNodesConfig,
  rewardFoldNodesOld,
  reclaimNode,
  CreateConfig,
  createConfig,
  FoldDatum,
  DInitNodeConfig,
  dinitNode,
  validatorToRewardAddress,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import alwaysFails from "./compiled/alwaysFails.json";
import {
  buildDeployFetchRefScripts,
  initializeLucidContext,
  insertThreeNodes,
  LucidContext,
} from "./setup.js";
import * as lucidE from "@lucid-evolution/lucid";

beforeEach<LucidContext>(initializeLucidContext);

test<LucidContext>("Test - initRewardTokenHolder - initStaking  - insertNodes - initFold - multiFold - initRewardFold \
- rewardFoldNodesOld - reclaimReward - dinit - account3 claimReward)", async ({
  lucid,
  users,
  emulator,
}) => {
  const logFlag = false;
  const network = lucid.config().network;
  const [treasuryUTxO] = await lucid
    .selectWalletFrom({ address: users.treasury1.address })
    .wallet.getUtxos();

  const [configUTxO] = await lucid
    .selectWalletFrom({ address: users.account1.address })
    .wallet.getUtxos();

  const currentTime = emulator.now();

  // DEPLOY
  lucid.selectWallet.fromSeed(users.account3.seedPhrase);
  const refUTxOsRes = await buildDeployFetchRefScripts(lucid, emulator);

  expect(refUTxOsRes.type).toBe("ok");
  if (refUTxOsRes.type == "error") return;
  const refUTxOs = refUTxOsRes.data;

  // CREATE CONFIG
  const createConfigObj: CreateConfig = {
    stakingConfig: {
      stakingInitUTXO: treasuryUTxO,

      freezeStake: currentTime + ONE_HOUR_MS,
      endStaking: currentTime + ONE_HOUR_MS + TWENTY_FOUR_HOURS_MS,
      penaltyAddress: users.treasury1.address,
      stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      stakeTN: "MIN",
      minimumStake: 1_000_000_000_000,
      rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      rewardTN: "MIN",
    },
    configInitUTXO: configUTxO,
    refScripts: {
      configPolicy: refUTxOs.configPolicy,
    },
    alwaysFails: alwaysFails.cborHex,
    currentTime: emulator.now(),
  };

  lucid.selectWallet.fromSeed(users.account1.seedPhrase);
  const createConfigUnsigned = await createConfig(lucid, createConfigObj);

  expect(createConfigUnsigned.type).toBe("ok");
  if (createConfigUnsigned.type == "error") return;
  const createConfigSigned = await createConfigUnsigned.data.tx
    .sign.withWallet()
    .complete();
  await createConfigSigned.submit();

  const configTN = createConfigUnsigned.data.configTN;

  emulator.awaitBlock(4);

  // REGISTER STAKE VALIDATOR
  emulator.distributeRewards(BigInt(100_000_000));

  const nodeStakeRewardAddress = validatorToRewardAddress(network,
    refUTxOs.nodeStakeValidator.scriptRef!,
  );

  await lucid.awaitTx(
    await (
      await (
        await lucid.newTx().registerStake(nodeStakeRewardAddress!).complete()
      )
        .sign.withWallet()
        .complete()
    ).submit(),
  );

  emulator.awaitBlock(4);

  // INIT STAKING
  const initStakingConfig: InitStakingConfig = {
    configTN: configTN,
    stakingInitUTXO: treasuryUTxO,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000_000_000_000,
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    rewardTN: "MIN",
    rewardAmount: 8_000_000_000_000,
    refScripts: refUTxOs,
  };

  lucid.selectWallet.fromSeed(users.treasury1.seedPhrase);
  const initStakingUnsigned = await initStaking(lucid, initStakingConfig);
  // console.log(initStakingUnsigned);

  expect(initStakingUnsigned.type).toBe("ok");
  if (initStakingUnsigned.type == "error") return;
  // console.log(tx.data.txComplete.to_json())
  const initStakingSigned = await initStakingUnsigned.data.sign.withWallet().complete();
  await initStakingSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "utxos at tokenholderScript",
        await utxosAtScript(
          lucid,
          refUTxOs.tokenHolderValidator.scriptRef?.script!,
        ),
      )
    : null;

  // INSERT NODES, ACCOUNT 1 -> ACCOUNT 2 -> ACCOUNT 3
  const freezeStake = currentTime + ONE_HOUR_MS;
  await insertThreeNodes(
    lucid,
    emulator,
    users,
    configTN,
    refUTxOs,
    freezeStake,
    logFlag,
  );

  // Wait for endStaking to pass
  emulator.awaitBlock(6000);

  // INIT FOLD
  const initFoldConfig: InitFoldConfig = {
    refScripts: refUTxOs,
    configTN: configTN,
    currentTime: emulator.now(),
  };

  lucid.selectWallet.fromSeed(users.treasury1.seedPhrase);
  const initFoldUnsigned = await initFold(lucid, initFoldConfig);

  expect(initFoldUnsigned.type).toBe("ok");
  if (initFoldUnsigned.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const initFoldSigned = await initFoldUnsigned.data.sign.withWallet().complete();
  const initFoldHash = await initFoldSigned.submit();

  emulator.awaitBlock(4);

  // MULTIFOLD

  const multiFoldConfig: MultiFoldConfig = {
    refScripts: refUTxOs,
    configTN: configTN,
    currentTime: emulator.now(),
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
  };

  const multiFoldUnsigned = await multiFold(lucid, multiFoldConfig);
  // console.log(multiFoldUnsigned)

  expect(multiFoldUnsigned.type).toBe("ok");
  if (multiFoldUnsigned.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  lucid.selectWallet.fromSeed(users.treasury1.seedPhrase);
  const multiFoldSigned = await multiFoldUnsigned.data.sign.withWallet().complete();
  const multiFoldHash = await multiFoldSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "Multifold result",
        JSON.stringify(
          await parseUTxOsAtScript(
            lucid,
            refUTxOs.foldValidator.scriptRef?.script!,
            FoldDatum,
          ),
          replacer,
          2,
        ),
      )
    : null;

  const initRewardFoldConfig: InitRewardFoldConfig = {
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    rewardTN: "MIN",
    refScripts: refUTxOs,
    configTN: configTN,
    penaltyAddress: users.treasury1.address,
  };

  lucid.selectWallet.fromSeed(users.treasury1.seedPhrase);
  const initRewardFoldUnsigned = await initRewardFold(
    lucid,
    initRewardFoldConfig,
  );
  // console.log(initRewardFoldUnsigned);

  expect(initRewardFoldUnsigned.type).toBe("ok");
  if (initRewardFoldUnsigned.type == "error") return;

  const initRewardFoldSigned = await initRewardFoldUnsigned.data
    .sign.withWallet()
    .complete();
  const initRewardFoldHash = await initRewardFoldSigned.submit();

  emulator.awaitBlock(4);

  // REWARD FOLD NODES

  const rewardFoldNodesConfig: RewardFoldNodesConfig = {
    configTN: configTN,
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    rewardTN: "MIN",
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    refScripts: refUTxOs,
    currentTime: emulator.now(),
  };

  lucid.selectWallet.fromSeed(users.treasury1.seedPhrase);
  // const provider = { ...lucid.provider };
  // const lucid_evol = await lucidE.Lucid(provider, lucid.network);
  // lucid_evol.selectWallet.fromSeed(users.treasury1.seedPhrase);
  const rewardFoldUnsigned = await rewardFoldNodesOld(
    lucid,
    rewardFoldNodesConfig,
  );
  // console.log(JSON.stringify(rewardFoldUnsigned, replacer));

  expect(rewardFoldUnsigned.type).toBe("ok");
  if (rewardFoldUnsigned.type == "error") return;
  // const completedRFold = await rewardFoldUnsigned.data.complete();
  // console.log(completedRFold.exUnits);
  // const rewardFoldSigned = await rewardFoldUnsigned.data.sign.withWallet().complete();
  const rewardFoldSigned = await rewardFoldUnsigned.data.sign.withWallet().complete();
  const rewardFoldHash = await rewardFoldSigned.submit();

  emulator.awaitBlock(4);

  // RECLAIM REWARD

  lucid.selectWallet.fromSeed(users.treasury1.seedPhrase);
  const reclaimRewardUnsigned = await reclaimReward(
    lucid,
    initRewardFoldConfig,
  );
  // console.log(reclaimRewardUnsigned);

  expect(reclaimRewardUnsigned.type).toBe("ok");
  if (reclaimRewardUnsigned.type == "error") return;

  const reclaimRewardSigned = await reclaimRewardUnsigned.data
    .sign()
    .complete();
  const rewardFoldHash4 = await reclaimRewardSigned.submit();

  emulator.awaitBlock(4);

  // DEINIT - Deinit should not affect the rewards fold or claims
  const dinitNodeConfig: DInitNodeConfig = {
    configTN: configTN,
    refScripts: refUTxOs,
    penaltyAddress: users.treasury1.address,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
  };
  const dinitNodeUnsigned = await dinitNode(lucid, dinitNodeConfig);
  // console.log(dinitNodeUnsigned);

  expect(dinitNodeUnsigned.type).toBe("ok");
  if (dinitNodeUnsigned.type == "error") return;
  const dinitNodeSigned = await dinitNodeUnsigned.data.sign.withWallet().complete();
  const dinitNodeHash = await dinitNodeSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "Reward Fold, Reclaim Reward & Dinit Completed. Result:",
        await parseUTxOsAtScript(
          lucid,
          refUTxOs.nodeValidator.scriptRef?.script!,
          SetNode,
        ),
      )
    : null;
  logFlag
    ? console.log(
        "Treasury Address/ Penalty Address",
        await lucid.utxosAt(users.treasury1.address),
      )
    : null;

  // CLAIM REWARD & STAKE
  const removeNodeConfig: RemoveNodeConfig = {
    configTN: configTN,
    refScripts: refUTxOs,
    currentTime: emulator.now(),
    freezeStake: currentTime + ONE_HOUR_MS,
    endStaking: currentTime + ONE_HOUR_MS + TWENTY_FOUR_HOURS_MS,
    penaltyAddress: users.treasury1.address,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
  };

  lucid.selectWallet.fromSeed(users.account3.seedPhrase);
  const removeNodeUnsigned = await reclaimNode(lucid, removeNodeConfig);
  // console.log(removeNodeUnsigned);
  expect(removeNodeUnsigned.type).toBe("ok");
  if (removeNodeUnsigned.type == "error") return;
  // console.log(removeNodeUnsigned.data.txComplete.to_json())
  const removeNodeSigned = await removeNodeUnsigned.data.sign.withWallet().complete();
  const removeNodeHash = await removeNodeSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "removeNode result",
        JSON.stringify(
          await parseUTxOsAtScript(
            lucid,
            refUTxOs.nodeValidator.scriptRef?.script!,
            SetNode,
          ),
          replacer,
          2,
        ),
      )
    : null;
  logFlag
    ? console.log(
        "account3 address with stake & reward",
        await lucid.utxosAt(users.account3.address),
      )
    : null;
});
