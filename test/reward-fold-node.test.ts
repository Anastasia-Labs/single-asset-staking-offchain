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
  rewardFoldNode,
  RewardFoldNodeConfig,
  TWENTY_FOUR_HOURS_MS,
  utxosAtScript,
  SetNode,
  reclaimReward,
  RemoveNodeConfig,
  dinitNode,
  DInitNodeConfig,
  reclaimNode,
  FoldDatum,
  createConfig,
  CreateConfig,
  FetchCampaignStateConfig,
  fetchCampaignState,
  CampaignStatus,
  FetchUserNodeConfig,
  fetchUserNode,
  fetchNodeUTxOs,
  fetchReadableNodeUTxOs,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import alwaysFails from "./compiled/alwaysFails.json";
import {
  buildDeployFetchRefScripts,
  checkCampaignStatus,
  initializeLucidContext,
  insertThreeNodes,
  LucidContext,
} from "./setup.js";

beforeEach<LucidContext>(initializeLucidContext);

test<LucidContext>("Test - initRewardTokenHolder - initStaking  - insertNodes - initFold - multiFold - initRewardFold \
- rewardFold1 - dinit - rewardFold2 - rewardFold3 - reclaimReward - account3 claimReward)", async ({
  lucid,
  users,
  emulator,
}) => {
  const logFlag = false;

  const [treasuryUTxO] = await lucid
    .selectWalletFrom({ address: users.treasury1.address })
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

  emulator.awaitBlock(4);

  await checkCampaignStatus(
    lucid,
    emulator,
    CampaignStatus.StakingNotStarted,
    refUTxOs,
    configTN,
    createConfigObj,
  );

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

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initStakingUnsigned = await initStaking(lucid, initStakingConfig);
  // console.log(initStakingUnsigned);

  expect(initStakingUnsigned.type).toBe("ok");
  if (initStakingUnsigned.type == "error") return;
  // console.log(tx.data.txComplete.to_json())
  const initStakingSigned = await initStakingUnsigned.data.sign().complete();
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

  await checkCampaignStatus(
    lucid,
    emulator,
    CampaignStatus.StakingOpen,
    refUTxOs,
    configTN,
    createConfigObj,
  );

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

  // FETCH STATE
  const userNodeConfig: FetchUserNodeConfig = {
    refScripts: refUTxOs,
    configTN: configTN,
    userAddress: users.account1.address,
  };

  const userNode = await fetchUserNode(lucid, userNodeConfig);

  expect(userNode.type).toBe("ok");
  if (userNode.type == "error") return;
  // console.log(userNode.data);

  const allNodes = await fetchNodeUTxOs(lucid, userNodeConfig);

  expect(allNodes.type).toBe("ok");
  if (allNodes.type == "error") return;
  // console.log(allNodes.data);

  const allReadableNodes = await fetchReadableNodeUTxOs(lucid, userNodeConfig);

  expect(allReadableNodes.type).toBe("ok");
  if (allReadableNodes.type == "error") return;
  // console.log(allReadableNodes.data);

  await checkCampaignStatus(
    lucid,
    emulator,
    CampaignStatus.StakingOpen,
    refUTxOs,
    configTN,
    createConfigObj,
  );

  // Wait for endStaking to pass
  emulator.awaitBlock(6000);

  await checkCampaignStatus(
    lucid,
    emulator,
    CampaignStatus.StakingEnded,
    refUTxOs,
    configTN,
    createConfigObj,
  );

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

  await checkCampaignStatus(
    lucid,
    emulator,
    CampaignStatus.StakeCalculationStarted,
    refUTxOs,
    configTN,
    createConfigObj,
  );

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

  await checkCampaignStatus(
    lucid,
    emulator,
    CampaignStatus.StakeCalculationEnded,
    refUTxOs,
    configTN,
    createConfigObj,
  );

  const initRewardFoldConfig: InitRewardFoldConfig = {
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    penaltyAddress: users.treasury1.address,
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

  await checkCampaignStatus(
    lucid,
    emulator,
    CampaignStatus.RewardsProcessingStarted,
    refUTxOs,
    configTN,
    createConfigObj,
  );

  // REWARD FOLD 1

  const rewardFoldConfig: RewardFoldNodeConfig = {
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    rewardTN: "MIN",
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    configTN: configTN,
    refScripts: refUTxOs,
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const rewardFoldUnsigned = await rewardFoldNode(lucid, rewardFoldConfig);
  // console.log(rewardFoldUnsigned);

  expect(rewardFoldUnsigned.type).toBe("ok");
  if (rewardFoldUnsigned.type == "error") return;
  const rewardFoldSigned = await rewardFoldUnsigned.data.sign().complete();
  const rewardFoldHash = await rewardFoldSigned.submit();

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
  const dinitNodeSigned = await dinitNodeUnsigned.data.sign().complete();
  const dinitNodeHash = await dinitNodeSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "dinitNode result ",
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

  await checkCampaignStatus(
    lucid,
    emulator,
    CampaignStatus.RewardsProcessingStarted,
    refUTxOs,
    configTN,
    createConfigObj,
  );

  // console.log("utxos at staking validator", await parseUTxOsAtScript(lucid, refUTxOs.nodeValidator, SetNode))

  // REWARD FOLD 2

  const rewardFoldUnsigned2 = await rewardFoldNode(lucid, {
    ...rewardFoldConfig,
    currentTime: emulator.now(),
  });
  // console.log(rewardFoldUnsigned2);

  expect(rewardFoldUnsigned2.type).toBe("ok");
  if (rewardFoldUnsigned2.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const rewardFoldSigned2 = await rewardFoldUnsigned2.data.sign().complete();
  const rewardFoldHash2 = await rewardFoldSigned2.submit();

  emulator.awaitBlock(4);

  // REWARD FOLD 3

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const rewardFoldUnsigned3 = await rewardFoldNode(lucid, {
    ...rewardFoldConfig,
    currentTime: emulator.now(),
  });
  // console.log(rewardFoldUnsigned2);

  expect(rewardFoldUnsigned3.type).toBe("ok");
  if (rewardFoldUnsigned3.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const rewardFoldSigned3 = await rewardFoldUnsigned3.data.sign().complete();
  const rewardFoldHash3 = await rewardFoldSigned3.submit();

  emulator.awaitBlock(4);

  // REWARD FOLD 4

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const rewardFoldUnsigned4 = await rewardFoldNode(lucid, {
    ...rewardFoldConfig,
    currentTime: emulator.now(),
  });
  // console.log(rewardFoldUnsigned4);

  expect(rewardFoldUnsigned4.type).toBe("error");
  if (rewardFoldUnsigned4.type == "ok") return;

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

  await checkCampaignStatus(
    lucid,
    emulator,
    CampaignStatus.UserClaimsAllowed,
    refUTxOs,
    configTN,
    createConfigObj,
  );

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
  const removeNodeUnsigned = await reclaimNode(lucid, removeNodeConfig);
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

  await checkCampaignStatus(
    lucid,
    emulator,
    CampaignStatus.UserClaimsAllowed,
    refUTxOs,
    configTN,
    createConfigObj,
  );
});
