import {
  buildScripts,
  initNode,
  InitNodeConfig,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  removeNode,
  RemoveNodeConfig,
  replacer,
  SetNode,
  TWENTY_FOUR_HOURS_MS,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import nodeValidator from "./compiled/nodeValidator.json";
import nodePolicy from "./compiled/nodePolicy.json";
import foldPolicy from "./compiled/foldPolicy.json";
import foldValidator from "./compiled/foldValidator.json";
import rewardFoldPolicy from "./compiled/rewardFoldPolicy.json";
import rewardFoldValidator from "./compiled/rewardFoldValidator.json";
import tokenHolderPolicy from "./compiled/tokenHolderPolicy.json";
import tokenHolderValidator from "./compiled/tokenHolderValidator.json";
import nodeStakeValidator from "./compiled/nodeStakeValidator.json";
import {
  deploy,
  getRefUTxOs,
  initializeLucidContext,
  insertThreeNodes,
  LucidContext,
} from "./setup.js";

beforeEach<LucidContext>(initializeLucidContext);

test.skip<LucidContext>("Test - initNode - account1 insertNode - account2 insertNode - account3 insertNode - account2 removeNode", async ({
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
  // Total blocks elapsed in step - 12
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

  // 1 block = 20 secs
  // 1 hour = 180 blocks
  // 24 hours = 4320 blocks

  // Total blocks eplased till now = 36 + 12 = 48

  // before freezeStake or within 1 hour - up to 148 blocks
  // emulator.awaitBlock(100); // Remove without penalty

  // after freezeStake and before endStaking
  // emulator.awaitBlock(200); // Remove with penalty

  // after endStaking
  // emulator.awaitBlock(5000); // Claim stake & reward

  // before freezeStake
  emulator.awaitBlock(100); // Remove without penalty

  // REMOVE NODE 1
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

  lucid.selectWalletFromSeed(users.account1.seedPhrase);
  const removeNodeUnsigned = await removeNode(lucid, removeNodeConfig);
  // console.log(removeNodeUnsigned);

  expect(removeNodeUnsigned.type).toBe("ok");
  if (removeNodeUnsigned.type == "error") return;

  const removeNodeSigned = await removeNodeUnsigned.data.sign().complete();
  const removeNodeHash = await removeNodeSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "removeNode 1 result",
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
        "account1 address with stake",
        await lucid.utxosAt(users.account1.address),
      )
    : null;

  // after freezeStake before endStaking
  emulator.awaitBlock(100); // Remove with penalty

  // REMOVE NODE 2
  const removeNodeConfig2: RemoveNodeConfig = {
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

  lucid.selectWalletFromSeed(users.account2.seedPhrase);
  const removeNodeUnsigned2 = await removeNode(lucid, removeNodeConfig2);

  expect(removeNodeUnsigned2.type).toBe("ok");
  if (removeNodeUnsigned2.type == "error") return;
  // console.log(removeNodeUnsigned.data.txComplete.to_json())
  const removeNodeSigned2 = await removeNodeUnsigned2.data.sign().complete();
  const removeNodeHash2 = await removeNodeSigned2.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "removeNode 2 result",
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
        "treasury address with penalty",
        await lucid.utxosAt(users.treasury1.address),
      )
    : null;

  // FAIL REMOVE NODE 2
  const removeNodeConfig3: RemoveNodeConfig = {
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

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const removeNodeUnsigned3 = await removeNode(lucid, removeNodeConfig3);

  expect(removeNodeUnsigned3.type).toBe("error");

  if (removeNodeUnsigned3.type == "ok") {
    const removeNodeSigned3 = await removeNodeUnsigned3.data.sign().complete();
    const removeNodeHash3 = await removeNodeSigned3.submit();
  }

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "failed removeNode result",
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

  // after endStaking
  emulator.awaitBlock(5000); //

  // FAIL REMOVE NODE 3
  const removeNodeConfig4: RemoveNodeConfig = {
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
  const removeNodeUnsigned4 = await removeNode(lucid, removeNodeConfig4);

  // console.log(removeNodeUnsigned4);
  expect(removeNodeUnsigned4.type).toBe("error");
  if (removeNodeUnsigned4.type == "ok") return;

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "removeNode 3 result",
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
});
