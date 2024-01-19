import {
  buildScripts,
  deployRefScripts,
  DeployRefScriptsConfig,
  Emulator,
  generateAccountSeedPhrase,
  initNode,
  InitNodeConfig,
  insertNode,
  InsertNodeConfig,
  Lucid,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  PROTOCOL_PAYMENT_KEY,
  PROTOCOL_STAKE_KEY,
  removeNode,
  RemoveNodeConfig,
  replacer,
  TWENTY_FOUR_HOURS_MS,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import stakingValidator from "./compiled/stakingValidator.json";
import stakingPolicy from "./compiled/stakingMint.json";
import foldPolicy from "./compiled/foldMint.json";
import foldValidator from "./compiled/foldValidator.json";
import rewardPolicy from "./compiled/rewardFoldMint.json";
import rewardValidator from "./compiled/rewardFoldValidator.json";
import tokenHolderPolicy from "./compiled/tokenHolderPolicy.json"
import tokenHolderValidator from "./compiled/tokenHolderValidator.json"
import alwaysFailValidator from "./compiled/alwaysFails.json";
import stakingStakeValidator from "./compiled/stakingStakeValidator.json";
import { deploy, getRefUTxOs, insertThreeNodes } from "./setup.js";

type LucidContext = {
  lucid: Lucid;
  users: any;
  emulator: Emulator;
};

// INITIALIZE EMULATOR + ACCOUNTS
beforeEach<LucidContext>(async (context) => {
  context.users = {
    treasury1: await generateAccountSeedPhrase({
      lovelace: BigInt(100_000_000),
    }),
    project1: await generateAccountSeedPhrase({
      lovelace: BigInt(100_000_000),
    }),
    account1: await generateAccountSeedPhrase({
      lovelace: BigInt(100_000_000),
    }),
    account2: await generateAccountSeedPhrase({
      lovelace: BigInt(100_000_000),
    }),
    account3: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
    }),
  };

  context.emulator = new Emulator([
    context.users.treasury1,
    context.users.project1,
    context.users.account1,
    context.users.account2,
    context.users.account3,
  ]);

  context.lucid = await Lucid.new(context.emulator);
});

test<LucidContext>("Test - initNode - account1 insertNode - account2 insertNode - account3 insertNode - account2 removeNode", async ({
  lucid,
  users,
  emulator,
}) => {
  const logFlag = false;
  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const treasuryAddress = await lucid.wallet.address();
  const [treasuryUTxO] = await lucid.wallet.getUtxos();
  const deadline = emulator.now() + TWENTY_FOUR_HOURS_MS + ONE_HOUR_MS; // 24 hours + 1 hour
  const [project1UTxO] = await lucid
    .selectWalletFromSeed(users.project1.seedPhrase)
    .wallet.getUtxos();

  const newScripts = buildScripts(lucid, {
    stakingPolicy: {
      initUTXO: treasuryUTxO,
      deadline: deadline,
      penaltyAddress: treasuryAddress,
    },
    rewardValidator: {
      projectCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      projectTN: "test",
      projectAddr: treasuryAddress,
    },
    projectTokenHolder: {
      initUTXO: project1UTxO,
    },
    unapplied: {
      stakingPolicy: stakingPolicy.cborHex,
      stakingValidator: stakingValidator.cborHex,
      stakingStake: stakingStakeValidator.cborHex,
      foldPolicy: foldPolicy.cborHex,
      foldValidator: foldValidator.cborHex,
      rewardPolicy: rewardPolicy.cborHex,
      rewardValidator: rewardValidator.cborHex,
      tokenHolderPolicy: tokenHolderPolicy.cborHex,
      tokenHolderValidator: tokenHolderValidator.cborHex,
    },
  });

  expect(newScripts.type).toBe("ok");
  if (newScripts.type == "error") return;

  // DEPLOY
  lucid.selectWalletFromSeed(users.account3.seedPhrase);
  const deployTime = emulator.now();
  
  // Total blocks elapsed in step - 36
  const deployRefScripts = await deploy(lucid, emulator, newScripts.data, emulator.now());
  
  // Find node refs script
  const deployPolicyId =
  deployRefScripts.type == "ok" ? deployRefScripts.data.deployPolicyId : "";

  const refUTxOs = await getRefUTxOs(lucid, deployPolicyId);

  // INIT NODE
  const initNodeConfig: InitNodeConfig = {
    initUTXO: treasuryUTxO,
    scripts: {
      nodePolicy: newScripts.data.stakingPolicy,
      nodeValidator: newScripts.data.stakingValidator,
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
          await parseUTxOsAtScript(lucid, newScripts.data.stakingValidator),
          replacer,
          2
        )
      )
    : null;

  // INSERT NODES, ACCOUNT 1 -> ACCOUNT 2 -> ACCOUNT 3
  // Total blocks elapsed in step - 12
  await insertThreeNodes(lucid, emulator, users, newScripts.data, refUTxOs, logFlag);

  //1 block = 20 secs
  //1 hour = 180 blocks
  //24 hours = 4320 blocks
  
  // Total blocks eplased till now = 36 + 12 = 48

  // before 24 hours - up to 148 blocks
  // emulator.awaitBlock(100); // Remove without penalty

  // within 24 hours of deadline
  // emulator.awaitBlock(200); // Remove with penalty

  // after deadline 24 hours + 1 hour = 4500 - 48 blocks from previous = 4452
  // 4445 is before deadline
  // emulator.awaitBlock(4445); // Remove with penalty

  // within 24 hours of deadline
  emulator.awaitBlock(200); // Remove with penalty

  logFlag
    ? console.log(
        "insertNode result",
        JSON.stringify(
          await parseUTxOsAtScript(lucid, newScripts.data.stakingValidator),
          replacer,
          2
        )
      )
    : null;

  // REMOVE NODE
  const removeNodeConfig: RemoveNodeConfig = {
    scripts: {
      nodePolicy: newScripts.data.stakingPolicy,
      nodeValidator: newScripts.data.stakingValidator,
    },
    refScripts: {
      nodeValidator: refUTxOs.nodeValidatorUTxO,
      nodePolicy: refUTxOs.nodePolicyUTxO,
    },
    currenTime: emulator.now(),
    deadline: deadline,
    penaltyAddress: treasuryAddress,
  };

  lucid.selectWalletFromSeed(users.account2.seedPhrase);
  const removeNodeUnsigned = await removeNode(lucid, removeNodeConfig);

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
          await parseUTxOsAtScript(lucid, newScripts.data.stakingValidator),
          replacer,
          2
        )
      )
    : null;
  logFlag
    ? console.log(
    "treasury address with penalty",
    await lucid.utxosAt(users.treasury1.address)
  ): null;

  // FAIL REMOVE NODE
  const removeNodeConfig2: RemoveNodeConfig = {
    scripts: {
      nodePolicy: newScripts.data.stakingPolicy,
      nodeValidator: newScripts.data.stakingValidator,
    },
    refScripts: {
      nodeValidator: refUTxOs.nodeValidatorUTxO,
      nodePolicy: refUTxOs.nodePolicyUTxO,
    },
    deadline: deadline,
    penaltyAddress: treasuryAddress,
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const removeNodeUnsigned2 = await removeNode(lucid, removeNodeConfig2);

  expect(removeNodeUnsigned2.type).toBe("error");

  if (removeNodeUnsigned2.type == "ok") {
    // console.log(insertNodeUnsigned.data.txComplete.to_json())
    lucid.selectWalletFromSeed(users.account2.seedPhrase);
    const removeNodeSigned2 = await removeNodeUnsigned2.data.sign().complete();
    const removeNodeHash = await removeNodeSigned2.submit();
  }

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "failed removeNode result",
        JSON.stringify(
          await parseUTxOsAtScript(lucid, newScripts.data.stakingValidator),
          replacer,
          2
        )
      )
    : null;
});
