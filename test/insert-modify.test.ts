import {
  buildScripts,
  initNode,
  InitNodeConfig,
  insertNode,
  InsertNodeConfig,
  modifyNode,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  replacer,
  SetNode,
  TWENTY_FOUR_HOURS_MS,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import nodeValidator from "./compiled/nodeValidator.json";
import nodePolicy from "./compiled/nodePolicy.json";
import nodeStakeValidator from "./compiled/nodeStakeValidator.json";
import foldPolicy from "./compiled/foldPolicy.json";
import foldValidator from "./compiled/foldValidator.json";
import rewardFoldPolicy from "./compiled/rewardFoldPolicy.json";
import rewardFoldValidator from "./compiled/rewardFoldValidator.json";
import tokenHolderPolicy from "./compiled/tokenHolderPolicy.json"
import tokenHolderValidator from "./compiled/tokenHolderValidator.json"
import { deploy, getRefUTxOs, initializeLucidContext, LucidContext } from "./setup.js";

beforeEach<LucidContext>(initializeLucidContext);

test<LucidContext>("Test - initNode - account1 insertNode - account2 insertNode \
 - account2 modifyNode - account1 modifyNode", async ({
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
      minimumStake : 1_000,
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
  const deployRefScripts = await deploy(lucid, emulator, newScripts.data, deployTime);
  
  expect(deployRefScripts.type).toBe("ok");
  if (deployRefScripts.type == "error") return;
  // Find node refs script
  const deployPolicyId = deployRefScripts.data.deployPolicyId;

  const refUTxOs = await getRefUTxOs(lucid, deployPolicyId);

  // INIT NODE
  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  
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
  const initNodeUnsigned = await initNode(lucid, initNodeConfig);
  
  expect(initNodeUnsigned.type).toBe("ok");
  if (initNodeUnsigned.type == "error") return;

  const initNodeSigned = await initNodeUnsigned.data.sign().complete();
  const initNodeHash = await initNodeSigned.submit();
  // console.log(initNodeHash)

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "initNode result ",
        JSON.stringify(
          await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode),
          replacer,
          2
        )
      )
    : null;

  // INSERT NODE ACCOUNT 1

  const insertNodeConfig: InsertNodeConfig = {
    scripts: {
      nodePolicy: newScripts.data.nodePolicy,
      nodeValidator: newScripts.data.nodeValidator,
    },
    refScripts: {
      nodeValidator: refUTxOs.nodeValidatorUTxO,
      nodePolicy: refUTxOs.nodePolicyUTxO,
    },
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000,
    toStake: 4_000,
    freezeStake: currentTime + ONE_HOUR_MS,
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.account1.seedPhrase);
  const insertNodeUnsigned = await insertNode(lucid, insertNodeConfig);
  // console.log(insertNodeUnsigned);

  expect(insertNodeUnsigned.type).toBe("ok");
  if (insertNodeUnsigned.type == "error") return;

  const insertNodeSigned = await insertNodeUnsigned.data.sign().complete();
  const insertNodeHash = await insertNodeSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "insertNode result",
        JSON.stringify(
          await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode),
          replacer,
          2
        )
      )
    : null;

  // INSERT NODE ACCOUNT 2

  const insertNodeConfig2: InsertNodeConfig = {
    scripts: {
      nodePolicy: newScripts.data.nodePolicy,
      nodeValidator: newScripts.data.nodeValidator,
    },
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000,
    toStake: 5_000,
    freezeStake: currentTime + ONE_HOUR_MS,
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.account2.seedPhrase);
  const insertNodeUnsigned2 = await insertNode(lucid, insertNodeConfig2);

  expect(insertNodeUnsigned2.type).toBe("ok");
  if (insertNodeUnsigned2.type == "error") return;

  const insertNodeSigned2 = await insertNodeUnsigned2.data.sign().complete();
  const insertNodeHash2 = await insertNodeSigned2.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "insertNode result",
        JSON.stringify(
          await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode),
          replacer,
          2
        )
      )
    : null;

  // MODIFY NODE ACCOUNT 2

  const modifyNodeConfig: InsertNodeConfig = {
    scripts: {
      nodePolicy: newScripts.data.nodePolicy,
      nodeValidator: newScripts.data.nodeValidator,
    },
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000,
    toStake: 10_000,
    freezeStake: currentTime + ONE_HOUR_MS,
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.account2.seedPhrase);
  const modifyNodeUnsigned = await modifyNode(lucid, modifyNodeConfig);
  // console.log(modifyNodeUnsigned);

  expect(modifyNodeUnsigned.type).toBe("ok");
  if (modifyNodeUnsigned.type == "error") return;

  const modifyNodeSigned = await modifyNodeUnsigned.data.sign().complete();
  const modifyNodeHash = await modifyNodeSigned.submit();

  emulator.awaitBlock(4);

  // MODIFY NODE ACCOUNT 1

  const modifyNodeConfig2: InsertNodeConfig = {
    scripts: {
      nodePolicy: newScripts.data.nodePolicy,
      nodeValidator: newScripts.data.nodeValidator,
    },
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000,
    toStake: 1_000,
    freezeStake: currentTime + ONE_HOUR_MS,
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.account1.seedPhrase);
  const modifyNodeUnsigned2 = await modifyNode(lucid, modifyNodeConfig2);
  // console.log(modifyNodeUnsigned2);

  expect(modifyNodeUnsigned2.type).toBe("ok");
  if (modifyNodeUnsigned2.type == "error") return;

  const modifyNodeSigned2 = await modifyNodeUnsigned2.data.sign().complete();
  const modifyNodeHash2 = await modifyNodeSigned2.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "modify node result",
        await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode),
      )
    : null;
});
