import {
  buildScripts,
  chunkArray,
  Data,
  deployRefScripts,
  Emulator,
  fromText,
  generateAccountSeedPhrase,
  initFold,
  InitFoldConfig,
  initNode,
  InitNodeConfig,
  initRewardFold,
  InitRewardFoldConfig,
  initTokenHolder,
  InitTokenHolderConfig,
  insertNode,
  InsertNodeConfig,
  Lucid,
  multiFold,
  MultiFoldConfig,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  replacer,
  RewardFoldDatum,
  sortByOutRefWithIndex,
  toUnit,
  TWENTY_FOUR_HOURS_MS,
  utxosAtScript,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import stakingValidator from "./compiled/stakingValidator.json";
import stakingPolicy from "./compiled/stakingMinting.json";
import stakingStake from "./compiled/stakingStakeValidator.json";
import foldPolicy from "./compiled/foldMint.json";
import foldValidator from "./compiled/foldValidator.json";
import rewardPolicy from "./compiled/rewardFoldMint.json";
import rewardValidator from "./compiled/rewardFoldValidator.json";
import tokenHolderPolicy from "./compiled/tokenHolderPolicy.json";
import tokenHolderValidator from "./compiled/tokenHolderValidator.json";
import alwaysFailValidator from "./compiled/alwaysFails.json";
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
      lovelace: BigInt(800_000_000),
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

test<LucidContext>("Test - initProjectTokenHolder - initNode  - insertNodes - initFold - multiFold - initRewardFold", async ({
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
      projectTN: "LOBSTER",
      projectAddr: treasuryAddress,
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
  
  const deployRefScripts = await deploy(lucid, emulator, newScripts.data, emulator.now());
  
  // Find node refs script
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

  // console.log(initNodeUnsigned.data.txComplete.to_json());
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
  
  // Wait for deadline to pass
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

  expect(initFoldUnsigned.type).toBe("ok");
  if (initFoldUnsigned.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const initFoldSigned = await initFoldUnsigned.data.sign().complete();
  const initFoldHash = await initFoldSigned.submit();

  emulator.awaitBlock(4);

  // MULTIFOLD

  const multiFoldConfig: MultiFoldConfig = {
    nodeRefInputs: sortByOutRefWithIndex(
      await parseUTxOsAtScript(lucid, newScripts.data.stakingValidator)
    ).map((data) => {
      return data.value.outRef;
    }),
    indices: sortByOutRefWithIndex(
      await parseUTxOsAtScript(lucid, newScripts.data.stakingValidator)
    ).map((data) => {
      return data.index;
    }),
    scripts: {
      foldPolicy: newScripts.data.foldPolicy,
      foldValidator: newScripts.data.foldValidator,
    },
    currenTime: emulator.now(),
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

  // console.log("fold validator utxo", await utxosAtScript(lucid,newScripts.data.foldValidator))
  // console.log(Data.from((await utxosAtScript(lucid, newScripts.data.foldValidator))[0].datum! ,FoldDatum))

  const initRewardFoldConfig: InitRewardFoldConfig = {
    projectCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    projectTN: "LOBSTER",
    scripts: {
      nodeValidator: newScripts.data.stakingValidator,
      nodePolicy: newScripts.data.stakingPolicy,
      foldPolicy: newScripts.data.foldPolicy,
      foldValidator: newScripts.data.foldValidator,
      rewardFoldPolicy: newScripts.data.rewardPolicy,
      rewardFoldValidator: newScripts.data.rewardValidator,
      tokenHolderPolicy: newScripts.data.tokenHolderPolicy,
      tokenHolderValidator: newScripts.data.tokenHolderValidator,
    },
    refScripts: {
      nodePolicy: refUTxOs.nodePolicyUTxO,
      nodeValidator: refUTxOs.nodeValidatorUTxO,
      commitFoldPolicy: refUTxOs.foldPolicyUTxO,
      commitFoldValidator: refUTxOs.foldValidatorUTxO,
      rewardFoldPolicy: refUTxOs.rewardPolicyUTxO,
      rewardFoldValidator: refUTxOs.rewardValidatorUTxO,
      tokenHolderPolicy: refUTxOs.tokenHolderPolicyUTxO,
      tokenHolderValidator: refUTxOs.tokenHolderValidatorUTxO,
    }
  };

  const initRewardFoldUnsigned = await initRewardFold(
    lucid,
    initRewardFoldConfig
  );

  expect(initRewardFoldUnsigned.type).toBe("ok");
  if (initRewardFoldUnsigned.type == "error") return;
  
  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initRewardFoldSigned = await initRewardFoldUnsigned.data
    .sign()
    .complete();
  const initRewardFoldHash = await initRewardFoldSigned.submit();

  emulator.awaitBlock(4);

  const utxos = await utxosAtScript(lucid,newScripts.data.rewardValidator);
  logFlag
    ? console.log(
        "init reward fold result",
        JSON.stringify(
          utxos,
          replacer,
          2
        )
      )
    : null;
  
  logFlag
  ? console.log(
      "RewardFoldDatum",
      JSON.stringify(
        Data.from(utxos[0].datum!, RewardFoldDatum),
        replacer,
        2
      )
    )
  : null;
});
