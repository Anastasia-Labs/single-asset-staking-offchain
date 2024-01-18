import {
  buildScripts,
  CborHex,
  deployRefScripts,
  DeployRefScriptsConfig,
  Emulator,
  fromText,
  generateAccountSeedPhrase,
  initNode,
  InitNodeConfig,
  initTokenHolder,
  InitTokenHolderConfig,
  Lucid,
  parseUTxOsAtScript,
  replacer,
  Script,
  toUnit,
  utxosAtScript,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import stakingValidator from "./compiled/stakingValidator.json";
import stakingPolicy from "./compiled/stakingMinting.json";
import stakingStake from "./compiled/stakingStakeValidator.json"
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
      lovelace: BigInt(500_000_000),
    }),
    project1: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
      [toUnit(
        "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
        fromText("LOBSTER")
      )]: BigInt(100_000_000),
    }),
    account1: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
    }),
    account2: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
    }),
    account3: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
    }),
    null: await generateAccountSeedPhrase({
      lovelace: BigInt(0),
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

test<LucidContext>("Test - deploy - initTokenHolder - initNode", async ({
  lucid,
  users,
  emulator,
}) => {
  const logFlag = false;

  const [treasuryUTxO] = await lucid
    .selectWalletFrom({ address: users.treasury1.address })
    .wallet.getUtxos();
  const [project1UTxO] = await lucid
    .selectWalletFrom({ address: users.project1.address })
    .wallet.getUtxos();

  const newScripts = buildScripts(lucid, {
    stakingPolicy: {
      initUTXO: treasuryUTxO,
      deadline: emulator.now() + 600_000, // 10 minutes
      penaltyAddress: users.treasury1.address,
    },
    rewardValidator: {
      projectCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      projectTN: "LOBSTER",
      projectAddr: users.treasury1.address,
    },
    projectTokenHolder: {
      initUTXO: project1UTxO,
    },
    unapplied: {
      stakingPolicy: stakingPolicy.cborHex,
      stakingValidator: stakingValidator.cborHex,
      stakingStake: stakingStake.cborHex,
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

  const deployRefScripts = await deploy(lucid, emulator, newScripts.data, deployTime);
  
  //Find node refs script
  const deployPolicyId =
  deployRefScripts.type == "ok" ? deployRefScripts.data.deployPolicyId : "";

  const refUTxOs = await getRefUTxOs(lucid, deployPolicyId);

  // INIT PROJECT TOKEN HOLDER
  const initTokenHolderConfig: InitTokenHolderConfig = {
    initUTXO: project1UTxO,
    projectCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    projectTN: "LOBSTER",
    projectAmount: 100_000_000,
    scripts: {
      tokenHolderPolicy: newScripts.data.tokenHolderPolicy,
      tokenHolderValidator: newScripts.data.tokenHolderValidator,
    },
  };

  lucid.selectWalletFromSeed(users.project1.seedPhrase);
  const initTokenHolderUnsigned = await initTokenHolder(
    lucid,
    initTokenHolderConfig
  );

  expect(initTokenHolderUnsigned.type).toBe("ok");
  if (initTokenHolderUnsigned.type == "ok") {
    const initTokenHolderSigned = await initTokenHolderUnsigned.data
      .sign()
      .complete();
    const initTokenHolderHash = await initTokenHolderSigned.submit();
  }
  // RESET WALLET
  lucid.selectWalletFromSeed(users.null.seedPhrase)

  emulator.awaitBlock(4);
  // console.log(
  //   "utxos at tokenholderScript",
  //   await utxosAtScript(lucid, newScripts.data.tokenHolderValidator)
  // );

  // INIT NODE - treasury1 account
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
  // console.log(tx.data.txComplete.to_json())
  const initNodeSigned = await initNodeUnsigned.data.sign().complete();
  const initNodeHash = await initNodeSigned.submit();
  // console.log(initNodeHash)
  // RESET WALLET
  lucid.selectWalletFromSeed(users.null.seedPhrase)

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
});
