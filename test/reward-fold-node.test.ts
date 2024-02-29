import {
  buildScripts,
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
  rewardFoldNode,
  RewardFoldNodeConfig,
  sortByOutRefWithIndex,
  TWENTY_FOUR_HOURS_MS,
  utxosAtScript,
  SetNode,
  reclaimReward,
  RemoveNodeConfig,
  removeNode,
  dinitNode,
  DInitNodeConfig,
  claimNode,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import nodeValidator from "./compiled/nodeValidator.json";
import nodePolicy from "./compiled/nodePolicy.json";
import nodeStakeValidator from "./compiled/nodeStakeValidator.json";
import foldPolicy from "./compiled/foldPolicy.json";
import foldValidator from "./compiled/foldValidator.json";
import rewardFoldPolicy from "./compiled/rewardFoldPolicy.json";
import rewardFoldValidator from "./compiled/rewardFoldValidator.json";
import tokenHolderPolicy from "./compiled/tokenHolderPolicy.json";
import tokenHolderValidator from "./compiled/tokenHolderValidator.json";
import {
  deploy,
  getRefUTxOs,
  initializeLucidContext,
  insertThreeNodes,
  LucidContext,
} from "./setup.js";

beforeEach<LucidContext>(initializeLucidContext);

test.skip<LucidContext>("Test - initRewardTokenHolder - initNode  - insertNodes - initFold - multiFold - initRewardFold \
- rewardFold1 - dinit - rewardFold2 - rewardFold3 - reclaimReward - account3 claimReward)", async ({
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

  const currentTime = emulator.now();

  const newScripts = buildScripts(lucid, {
    nodePolicy: {
      initUTXO: treasuryUTxO,
      freezeStake: currentTime + ONE_HOUR_MS,
      endStaking: currentTime + ONE_HOUR_MS + TWENTY_FOUR_HOURS_MS,
      penaltyAddress: users.treasury1.address,
      stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      stakeTN: "MIN",
      minimumStake: 1_000,
    },
    rewardFoldValidator: {
      rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      rewardTN: "MIN",
    },
    rewardTokenHolder: {
      initUTXO: reward1UTxO,
    },
    unapplied: {
      nodePolicy: nodePolicy.cborHex,
      nodeValidator: nodeValidator.cborHex,
      nodeStakeValidator: nodeStakeValidator.cborHex,
      foldPolicy: foldPolicy.cborHex,
      foldValidator: foldValidator.cborHex,
      rewardFoldPolicy: rewardFoldPolicy.cborHex,
      rewardFoldValidator: rewardFoldValidator.cborHex,
      tokenHolderPolicy: tokenHolderPolicy.cborHex,
      tokenHolderValidator: tokenHolderValidator.cborHex,
    },
  });

  expect(newScripts.type).toBe("ok");
  if (newScripts.type == "error") return;

  // DEPLOY
  lucid.selectWalletFromSeed(users.account3.seedPhrase);

  const deployTime = emulator.now();
  const deployRefScripts = await deploy(
    lucid,
    emulator,
    newScripts.data,
    deployTime,
  );

  expect(deployRefScripts.type).toBe("ok");
  if (deployRefScripts.type == "error") return;
  // Find node refs script
  const deployPolicyId = deployRefScripts.data.deployPolicyId;

  const refUTxOs = await getRefUTxOs(lucid, deployPolicyId);

  // REGISTER STAKE VALIDATOR
  emulator.distributeRewards(BigInt(100_000_000));

  const nodeStakeRewardAddress = lucid.utils.validatorToRewardAddress({
    type: "PlutusV2",
    script: newScripts.data.nodeStakeValidator,
  });

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
    initUTXO: reward1UTxO,
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    rewardTN: "MIN",
    rewardAmount: 90_000_000,
    scripts: {
      tokenHolderPolicy: newScripts.data.tokenHolderPolicy,
      tokenHolderValidator: newScripts.data.tokenHolderValidator,
    },
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
  // console.log(
  //   "utxos at tokenholderScript",
  //   await utxosAtScript(lucid, newScripts.data.tokenHolderValidator)
  // );

  // INIT NODE
  const initNodeConfig: InitNodeConfig = {
    initUTXO: treasuryUTxO,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1000,
    scripts: {
      nodePolicy: newScripts.data.nodePolicy,
      nodeValidator: newScripts.data.nodeValidator,
    },
    refScripts: {
      nodePolicy: refUTxOs.nodePolicyUTxO,
    },
  };
  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initNodeUnsigned = await initNode(lucid, initNodeConfig);

  expect(initNodeUnsigned.type).toBe("ok");
  if (initNodeUnsigned.type == "error") return;

  const initNodeSigned = await initNodeUnsigned.data.sign().complete();
  const initNodeHash = await initNodeSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "initNode result ",
        JSON.stringify(
          await parseUTxOsAtScript(
            lucid,
            newScripts.data.nodeValidator,
            SetNode,
          ),
          replacer,
          2,
        ),
      )
    : null;

  // INSERT NODES, ACCOUNT 1 -> ACCOUNT 2 -> ACCOUNT 3
  const freezeStake = currentTime + ONE_HOUR_MS;
  await insertThreeNodes(
    lucid,
    emulator,
    users,
    newScripts.data,
    refUTxOs,
    freezeStake,
    logFlag,
  );

  // Wait for freezeStake to pass
  emulator.awaitBlock(6000);

  // INIT FOLD
  const initFoldConfig: InitFoldConfig = {
    scripts: {
      nodeValidator: newScripts.data.nodeValidator,
      nodePolicy: newScripts.data.nodePolicy,
      foldPolicy: newScripts.data.foldPolicy,
      foldValidator: newScripts.data.foldValidator,
    },
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
    nodeRefInputs: sortByOutRefWithIndex(
      await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode),
    ).map((data) => {
      return data.value.outRef;
    }),
    indices: sortByOutRefWithIndex(
      await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode),
    ).map((data) => {
      return data.index;
    }),
    scripts: {
      foldPolicy: newScripts.data.foldPolicy,
      foldValidator: newScripts.data.foldValidator,
    },
    currentTime: emulator.now(),
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const multiFoldUnsigned = await multiFold(lucid, multiFoldConfig);
  // console.log(multiFoldUnsigned)

  expect(multiFoldUnsigned.type).toBe("ok");
  if (multiFoldUnsigned.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const multiFoldSigned = await multiFoldUnsigned.data.sign().complete();
  const multiFoldHash = await multiFoldSigned.submit();

  emulator.awaitBlock(4);

  // console.log("fold validator utxo", await utxosAtScript(lucid,newScripts.data.foldValidator))
  // console.log(Data.from((await utxosAtScript(lucid, newScripts.data.foldValidator))[0].datum! ,FoldDatum))
  // INIT REWARD FOLD

  const initRewardFoldConfig: InitRewardFoldConfig = {
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    rewardTN: "MIN",
    scripts: {
      nodeValidator: newScripts.data.nodeValidator,
      nodePolicy: newScripts.data.nodePolicy,
      nodeStakeValidator: newScripts.data.nodeStakeValidator,
      foldPolicy: newScripts.data.foldPolicy,
      foldValidator: newScripts.data.foldValidator,
      rewardFoldPolicy: newScripts.data.rewardFoldPolicy,
      rewardFoldValidator: newScripts.data.rewardFoldValidator,
      tokenHolderPolicy: newScripts.data.tokenHolderPolicy,
      tokenHolderValidator: newScripts.data.tokenHolderValidator,
    },
    refScripts: {
      nodePolicy: refUTxOs.nodePolicyUTxO,
      nodeValidator: refUTxOs.nodeValidatorUTxO,
      foldPolicy: refUTxOs.foldPolicyUTxO,
      foldValidator: refUTxOs.foldValidatorUTxO,
      rewardFoldPolicy: refUTxOs.rewardPolicyUTxO,
      rewardFoldValidator: refUTxOs.rewardValidatorUTxO,
      tokenHolderPolicy: refUTxOs.tokenHolderPolicyUTxO,
      tokenHolderValidator: refUTxOs.tokenHolderValidatorUTxO,
      nodeStakeValidator: refUTxOs.nodeStakeValidatorUTxO,
    },
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initRewardFoldUnsigned = await initRewardFold(
    lucid,
    initRewardFoldConfig,
  );

  expect(initRewardFoldUnsigned.type).toBe("ok");
  if (initRewardFoldUnsigned.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const initRewardFoldSigned = await initRewardFoldUnsigned.data
    .sign()
    .complete();
  const initRewardFoldHash = await initRewardFoldSigned.submit();

  emulator.awaitBlock(4);

  // REWARD FOLD 1

  const nodeUTxOs = await utxosAtScript(lucid, newScripts.data.nodeValidator);

  const refScripts = {
    nodeValidator: refUTxOs.nodeValidatorUTxO,
    nodeStakeValidator: refUTxOs.nodeStakeValidatorUTxO,
    rewardFoldPolicy: refUTxOs.rewardPolicyUTxO,
    rewardFoldValidator: refUTxOs.rewardValidatorUTxO,
  };
  // console.log(refScripts);

  const rewardFoldConfig: RewardFoldNodeConfig = {
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    rewardTN: "MIN",
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    scripts: {
      nodeValidator: newScripts.data.nodeValidator,
      nodeStakeValidator: newScripts.data.nodeStakeValidator,
      rewardFoldPolicy: newScripts.data.rewardFoldPolicy,
      rewardFoldValidator: newScripts.data.rewardFoldValidator,
    },
    refScripts: refScripts,
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
    scripts: {
      nodePolicy: newScripts.data.nodePolicy,
      nodeValidator: newScripts.data.nodeValidator,
    },
    refScripts: {
      nodePolicy: refUTxOs.nodePolicyUTxO,
      nodeValidator: refUTxOs.nodeValidatorUTxO,
    },
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
            newScripts.data.nodeValidator,
            SetNode,
          ),
          replacer,
          2,
        ),
      )
    : null;

  // console.log("utxos at staking validator", await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode))

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
        await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode),
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
    scripts: {
      nodePolicy: newScripts.data.nodePolicy,
      nodeValidator: newScripts.data.nodeValidator,
    },
    refScripts: {
      nodeValidator: refUTxOs.nodeValidatorUTxO,
      nodePolicy: refUTxOs.nodePolicyUTxO,
    },
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
            newScripts.data.nodeValidator,
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
