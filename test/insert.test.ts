import {
  buildScripts,
  deployRefScripts,
  DeployRefScriptsConfig,
  Emulator,
  fromText,
  generateAccountSeedPhrase,
  initNode,
  InitNodeConfig,
  insertNode,
  InsertNodeConfig,
  Lucid,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  replacer,
  toUnit,
  TWENTY_FOUR_HOURS_MS,
  utxosAtScript,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import stakingValidator from "./compiled/stakingValidator.json";
import stakingPolicy from "./compiled/stakingMint.json";
import stakingStakeValidator from "./compiled/stakingStakeValidator.json";
import foldPolicy from "./compiled/foldMint.json";
import foldValidator from "./compiled/foldValidator.json";
import rewardPolicy from "./compiled/rewardFoldMint.json";
import rewardValidator from "./compiled/rewardFoldValidator.json";
import tokenHolderPolicy from "./compiled/tokenHolderPolicy.json"
import tokenHolderValidator from "./compiled/tokenHolderValidator.json"
import alwaysFailValidator from "./compiled/alwaysFails.json";
import { deploy, getRefUTxOs } from "./setup.js";

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
    reward1: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
      [toUnit(
        "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
        fromText("LOBSTER")
      )]: BigInt(100_000_000),
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
    context.users.reward1,
    context.users.account1,
    context.users.account2,
    context.users.account3,
  ]);

  context.lucid = await Lucid.new(context.emulator);
});

test<LucidContext>("Test - initNode - account1 insertNode - account2 insertNode", async ({
  lucid,
  users,
  emulator,
}) => {
  const logFlag = false;
  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const treasuryAddress = await lucid.wallet.address();
  const [treasuryUTxO] = await lucid.wallet.getUtxos();
  const [reward1UTxO] = await lucid.selectWalletFromSeed(users.reward1.seedPhrase).wallet.getUtxos()

  const newScripts = buildScripts(lucid, {
    stakingPolicy: {
      initUTXO: treasuryUTxO,
      freezeStake: emulator.now() + TWENTY_FOUR_HOURS_MS + ONE_HOUR_MS, // 24 hours + 1 hour
      penaltyAddress: treasuryAddress,
    },
    rewardValidator: {
      rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      rewardTN: "LOBSTER",
      rewardAddr: treasuryAddress,
    },
    rewardTokenHolder:{
      initUTXO: reward1UTxO
    },
    unapplied: {
      stakingPolicy: stakingPolicy.cborHex,
      stakingValidator: stakingValidator.cborHex,
      stakingStakeValidator: stakingStakeValidator.cborHex,
      foldPolicy: foldPolicy.cborHex,
      foldValidator: foldValidator.cborHex,
      rewardPolicy: rewardPolicy.cborHex,
      rewardValidator: rewardValidator.cborHex,
      tokenHolderPolicy: tokenHolderPolicy.cborHex,
      tokenHolderValidator: tokenHolderValidator.cborHex
    },
  });

  expect(newScripts.type).toBe("ok");
  if (newScripts.type == "error") return

  // DEPLOY
  lucid.selectWalletFromSeed(users.account3.seedPhrase);
  
  const deployRefScripts = await deploy(lucid, emulator, newScripts.data, emulator.now());
  
  //Find node refs script
  const deployPolicyId =
    deployRefScripts.type == "ok" ? deployRefScripts.data.deployPolicyId : "";

  const refUTxOs = await getRefUTxOs(lucid, deployPolicyId);

  // INIT NODE
  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  
  const initNodeConfig: InitNodeConfig = {
    initUTXO: treasuryUTxO,
    scripts: {
      nodePolicy: newScripts.data.stakingPolicy,
      nodeValidator: newScripts.data.stakingValidator,
    },
    refScripts: {
      nodePolicy: refUTxOs.nodePolicyUTxO,
    }
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
          await parseUTxOsAtScript(lucid, newScripts.data.stakingValidator),
          replacer,
          2
        )
      )
    : null;

  // INSERT NODE ACCOUNT 1

  const insertNodeConfig: InsertNodeConfig = {
    scripts: {
      nodePolicy: newScripts.data.stakingPolicy,
      nodeValidator: newScripts.data.stakingValidator,
    },
    refScripts: {
      nodeValidator: refUTxOs.nodeValidatorUTxO,
      nodePolicy: refUTxOs.nodePolicyUTxO,
    },
    amountLovelace: 4_000_000,
    currenTime: emulator.now(),
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
          await parseUTxOsAtScript(lucid, newScripts.data.stakingValidator),
          replacer,
          2
        )
      )
    : null;

  // INSERT NODE ACCOUNT 2

  const insertNodeConfig2: InsertNodeConfig = {
    scripts: {
      nodePolicy: newScripts.data.stakingPolicy,
      nodeValidator: newScripts.data.stakingValidator,
    },
    refScripts: {
      nodeValidator: refUTxOs.nodeValidatorUTxO,
      nodePolicy: refUTxOs.nodePolicyUTxO,
    },
    amountLovelace: 5_000_000,
    currenTime: emulator.now(),
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
          await parseUTxOsAtScript(lucid, newScripts.data.stakingValidator),
          replacer,
          2
        )
      )
    : null;
});
