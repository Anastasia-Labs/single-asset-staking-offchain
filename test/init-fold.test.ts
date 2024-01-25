import {
  buildScripts,
  deployRefScripts,
  DeployRefScriptsConfig,
  Emulator,
  fromText,
  generateAccountSeedPhrase,
  initFold,
  InitFoldConfig,
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
import tokenHolderPolicy from "./compiled/tokenHolderPolicy.json";
import tokenHolderValidator from "./compiled/tokenHolderValidator.json";
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
    reward1: await generateAccountSeedPhrase({
      lovelace: BigInt(100_000_000),
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

test<LucidContext>("Test - initNode - account1 insertNode - account2 insertNode - account3 insertNode - treasury1 initFold", async ({
  lucid,
  users,
  emulator,
}) => {
  const logFlag = false;
  
  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const treasuryAddress = await lucid.wallet.address();
  const [treasuryUTxO] = await lucid.wallet.getUtxos();
  const freezeStake = emulator.now() + TWENTY_FOUR_HOURS_MS + ONE_HOUR_MS; // 24 hours + 1 hour
  const [reward1UTxO] = await lucid
    .selectWalletFromSeed(users.reward1.seedPhrase)
    .wallet.getUtxos();

  const newScripts = buildScripts(lucid, {
    stakingPolicy: {
      initUTXO: treasuryUTxO,
      freezeStake: freezeStake,
      penaltyAddress: treasuryAddress,
    },
    rewardValidator: {
      rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      rewardTN: "LOBSTER",
      rewardAddr: treasuryAddress,
    },
    rewardTokenHolder: {
      initUTXO: reward1UTxO,
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
      tokenHolderValidator: tokenHolderValidator.cborHex,
    },
  });

  expect(newScripts.type).toBe("ok");
  if (newScripts.type == "error") return;

  // DEPLOY
  lucid.selectWalletFromSeed(users.account3.seedPhrase);
  
  const deployRefScripts = await deploy(lucid, emulator, newScripts.data, emulator.now());
  
  //Find node refs script
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
    }
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
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

  // INSERT NODES, ACCOUNT 1 -> ACCOUNT 2 -> ACCOUNT 3
  await insertThreeNodes(lucid, emulator, users, newScripts.data, refUTxOs, logFlag);

  // Wait for freezeStake to pass
  emulator.awaitBlock(6000);

  // INIT FOLD

  const initFoldConfig: InitFoldConfig = {
    scripts: {
      nodeValidator: newScripts.data.stakingValidator,
      nodePolicy: newScripts.data.stakingPolicy,
      foldPolicy: newScripts.data.foldPolicy,
      foldValidator: newScripts.data.foldValidator,
    },
    currenTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initFoldUnsigned = await initFold(lucid, initFoldConfig);

  // console.log(initFoldUnsigned);
  expect(initFoldUnsigned.type).toBe("ok");
  if (initFoldUnsigned.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  
  const initFoldSigned = await initFoldUnsigned.data.sign().complete();
  const initFoldHash = await initFoldSigned.submit();

  emulator.awaitBlock(100);

  logFlag
    ? console.log(
        "init fold result",
        JSON.stringify(
          await utxosAtScript(lucid, newScripts.data.foldValidator),
          replacer,
          2
        )
      )
    : null;
});
