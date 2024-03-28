import {
  initFold,
  InitFoldConfig,
  initNode,
  InitNodeConfig,
  initRewardFold,
  InitRewardFoldConfig,
  initTokenHolder,
  InitTokenHolderConfig,
  multiFold,
  MultiFoldConfig,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  replacer,
  RewardFoldNodeConfig,
  sortByOutRefWithIndex,
  TWENTY_FOUR_HOURS_MS,
  utxosAtScript,
  SetNode,
  reclaimReward,
  RemoveNodeConfig,
  RewardFoldNodesConfig,
  rewardFoldNodes,
  claimNode,
  CreateConfig,
  createConfig,
  FoldDatum,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import alwaysFails from "./compiled/alwaysFails.json";
import {
  buildDeployFetchRefScripts,
  initializeLucidContext,
  insertThreeNodes,
  LucidContext,
} from "./setup.js";

beforeEach<LucidContext>(initializeLucidContext);

test<LucidContext>("Test - initRewardTokenHolder - initNode  - insertNodes - initFold - multiFold - initRewardFold \
- rewardFoldNodes - reclaimReward - account3 claimReward)", async ({
  lucid,
  users,
  emulator,
}) => {
  const logFlag = false;

  const [treasuryUTxO] = await lucid
    .selectWalletFrom({ address: users.treasury1.address })
    .wallet.getUtxos();
  const [reward1UTxO] = await lucid
    .selectWalletFrom({ address: users.reward1.address })
    .wallet.getUtxos();
  const [configUTxO] = await lucid
    .selectWalletFrom({ address: users.account1.address })
    .wallet.getUtxos();

  const currentTime = emulator.now();

  // DEPLOY
  lucid.selectWalletFromSeed(users.account3.seedPhrase);
  const refUTxOsRes = await buildDeployFetchRefScripts(lucid, emulator);

  expect(refUTxOsRes.type).toBe("ok");
  if (refUTxOsRes.type == "error") return;
  const refUTxOs = refUTxOsRes.data;

  // CREATE CONFIG
  const createConfigObj: CreateConfig = {
    stakingConfig: {
      stakingInitUTXO: treasuryUTxO,
      rewardInitUTXO: reward1UTxO,
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

  lucid.selectWalletFromSeed(users.account1.seedPhrase);
  const createConfigUnsigned = await createConfig(lucid, createConfigObj);

  expect(createConfigUnsigned.type).toBe("ok");
  if (createConfigUnsigned.type == "error") return;
  const createConfigSigned = await createConfigUnsigned.data.tx
    .sign()
    .complete();
  await createConfigSigned.submit();

  const configTN = createConfigUnsigned.data.configTN;

  emulator.awaitBlock(4);

  // REGISTER STAKE VALIDATOR
  emulator.distributeRewards(BigInt(100_000_000));

  const nodeStakeRewardAddress = lucid.utils.validatorToRewardAddress(
    refUTxOs.nodeStakeValidator.scriptRef!,
  );

  await lucid.awaitTx(
    await (
      await (
        await lucid.newTx().registerStake(nodeStakeRewardAddress!).complete()
      )
        .sign()
        .complete()
    ).submit(),
  );

  // INIT PROJECT TOKEN HOLDER
  const initTokenHolderConfig: InitTokenHolderConfig = {
    configTN: configTN,
    rewardInitUTXO: reward1UTxO,
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    rewardTN: "MIN",
    rewardAmount: 90_000_000,
    refScripts: refUTxOs,
  };

  lucid.selectWalletFromSeed(users.reward1.seedPhrase);
  const initTokenHolderUnsigned = await initTokenHolder(
    lucid,
    initTokenHolderConfig,
  );
  // console.log(initTokenHolderUnsigned)

  expect(initTokenHolderUnsigned.type).toBe("ok");
  if (initTokenHolderUnsigned.type == "ok") {
    const initTokenHolderSigned = await initTokenHolderUnsigned.data
      .sign()
      .complete();
    const initTokenHolderHash = await initTokenHolderSigned.submit();
  }

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

  // INIT NODE
  const initNodeConfig: InitNodeConfig = {
    configTN: configTN,
    stakingInitUTXO: treasuryUTxO,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000_000_000_000,
    refScripts: refUTxOs,
  };
  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initNodeUnsigned = await initNode(lucid, initNodeConfig);

  expect(initNodeUnsigned.type).toBe("ok");
  if (initNodeUnsigned.type == "error") return;

  // console.log(initNodeUnsigned.data.txComplete.to_json());
  const initNodeSigned = await initNodeUnsigned.data.sign().complete();
  const initNodeHash = await initNodeSigned.submit();
  // console.log(initNodeHash)

  emulator.awaitBlock(4);

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

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initFoldUnsigned = await initFold(lucid, initFoldConfig);

  expect(initFoldUnsigned.type).toBe("ok");
  if (initFoldUnsigned.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const initFoldSigned = await initFoldUnsigned.data.sign().complete();
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
  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const multiFoldSigned = await multiFoldUnsigned.data.sign().complete();
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
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initRewardFoldUnsigned = await initRewardFold(
    lucid,
    initRewardFoldConfig,
  );
  // console.log(initRewardFoldUnsigned);

  expect(initRewardFoldUnsigned.type).toBe("ok");
  if (initRewardFoldUnsigned.type == "error") return;

  const initRewardFoldSigned = await initRewardFoldUnsigned.data
    .sign()
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

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const rewardFoldUnsigned = await rewardFoldNodes(
    lucid,
    rewardFoldNodesConfig,
  );
  // console.log(rewardFoldUnsigned);

  expect(rewardFoldUnsigned.type).toBe("ok");
  if (rewardFoldUnsigned.type == "error") return;
  const rewardFoldSigned = await rewardFoldUnsigned.data.sign().complete();
  const rewardFoldHash = await rewardFoldSigned.submit();

  emulator.awaitBlock(4);

  // RECLAIM REWARD

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
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

  logFlag
    ? console.log(
        "Reward Fold & Reclaim Reward Completed. Result:",
        await parseUTxOsAtScript(
          lucid,
          refUTxOs.nodeValidator.scriptRef?.script!,
          SetNode,
        ),
      )
    : null;
  logFlag
    ? console.log(
        "Treasury Address",
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

  lucid.selectWalletFromSeed(users.account3.seedPhrase);
  const removeNodeUnsigned = await claimNode(lucid, removeNodeConfig);
  // console.log(removeNodeUnsigned);
  expect(removeNodeUnsigned.type).toBe("ok");
  if (removeNodeUnsigned.type == "error") return;
  // console.log(removeNodeUnsigned.data.txComplete.to_json())
  const removeNodeSigned = await removeNodeUnsigned.data.sign().complete();
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
