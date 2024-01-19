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
  PROTOCOL_PAYMENT_KEY,
  PROTOCOL_STAKE_KEY,
  replacer,
  rewardFold,
  RewardFoldConfig,
  sortByOutRefWithIndex,
  toUnit,
  TWENTY_FOUR_HOURS_MS,
  utxosAtScript,
  FoldDatum
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import stakingValidator from "./compiled/stakingValidator.json";
import stakingPolicy from "./compiled/stakingMint.json";
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

test<LucidContext>("Test - initProjectTokenHolder - initNode  - insertNodes - initFold - multiFold - initRewardFold - rewardFold)", async ({
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
  const deployTime = emulator.now();
  
  const deployRefScripts = await deploy(lucid, emulator, newScripts.data, emulator.now());
  
  // Find node refs script
  const deployPolicyId =
  deployRefScripts.type == "ok" ? deployRefScripts.data.deployPolicyId : "";

  const refUTxOs = await getRefUTxOs(lucid, deployPolicyId);

  // REGISTER STAKE VALIDATOR
  emulator.distributeRewards(BigInt(100_000_000));

  const stakingStakeRewardAddress = lucid.utils.validatorToRewardAddress({
    type: "PlutusV2",
    script: newScripts.data.stakingStake,
  });

  await lucid.awaitTx(
    await (
      await (
        await lucid
          .newTx()
          .registerStake(stakingStakeRewardAddress!)
          .complete()
      )
        .sign()
        .complete()
    ).submit()
  );

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
    },
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initRewardFoldUnsigned = await initRewardFold(
    lucid,
    initRewardFoldConfig
  );

  expect(initRewardFoldUnsigned.type).toBe("ok");
  if (initRewardFoldUnsigned.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const initRewardFoldSigned = await initRewardFoldUnsigned.data
    .sign()
    .complete();
  const initRewardFoldHash = await initRewardFoldSigned.submit();

  emulator.awaitBlock(4);
  
  // const utxos = await utxosAtScript(lucid,newScripts.data.rewardValidator);
  // logFlag
  //   ? console.log(
  //       "init reward fold result",
  //       JSON.stringify(
  //         utxos,
  //         replacer,
  //         2
  //       )
  //     )
  //   : null;
  
  // logFlag
  // ? console.log(
  //     "RewardFoldDatum",
  //     JSON.stringify(
  //       Data.from(utxos[0].datum!, RewardFoldDatum),
  //       replacer,
  //       2
  //     )
  //   )
  // : null;

  // REWARD FOLD 1

  const nodeUTxOs = await utxosAtScript(
    lucid,
    newScripts.data.stakingValidator
  );

  const refScripts = {
    nodeValidator: refUTxOs.nodeValidatorUTxO,
    stakingStake: refUTxOs.nodeStakeValidatorUTxO,
    rewardFoldPolicy: refUTxOs.rewardPolicyUTxO,
    rewardFoldValidator: refUTxOs.rewardValidatorUTxO,
  };
  // console.log(refScripts);

  const rewardFoldConfig: RewardFoldConfig = {
    nodeInputs: nodeUTxOs,
    projectCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    projectTN: "LOBSTER",
    projectAddress: treasuryAddress,
    scripts: {
      nodeValidator: newScripts.data.stakingValidator,
      stakingStake: newScripts.data.stakingStake,
      rewardFoldPolicy: newScripts.data.rewardPolicy,
      rewardFoldValidator: newScripts.data.rewardValidator,
    },
    refScripts: refScripts,
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const rewardFoldUnsigned = await rewardFold(lucid, rewardFoldConfig);
  // console.log(rewardFoldUnsigned);

  expect(rewardFoldUnsigned.type).toBe("ok");
  if (rewardFoldUnsigned.type == "error") return;
  const rewardFoldSigned = await rewardFoldUnsigned.data.sign().complete();
  const rewardFoldHash = await rewardFoldSigned.submit();

  emulator.awaitBlock(4);

  // console.log("utxos at staking validator", await parseUTxOsAtScript(lucid, newScripts.data.stakingValidator))

  // REWARD FOLD 2

  const rewardFoldConfig2: RewardFoldConfig = {
    nodeInputs: nodeUTxOs,
    projectCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    projectTN: "LOBSTER",
    projectAddress: treasuryAddress,
    scripts: {
      nodeValidator: newScripts.data.stakingValidator,
      stakingStake: newScripts.data.stakingStake,
      rewardFoldPolicy: newScripts.data.rewardPolicy,
      rewardFoldValidator: newScripts.data.rewardValidator,
    },
    refScripts: refScripts,
  };

  const rewardFoldUnsigned2 = await rewardFold(lucid, rewardFoldConfig2);
  // console.log(rewardFoldUnsigned2);

  expect(rewardFoldUnsigned2.type).toBe("ok");
  if (rewardFoldUnsigned2.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const rewardFoldSigned2 = await rewardFoldUnsigned2.data.sign().complete();
  const rewardFoldHash2 = await rewardFoldSigned2.submit();

  emulator.awaitBlock(4);

  // REWARD FOLD 3

  const rewardFoldConfig3: RewardFoldConfig = {
    nodeInputs: nodeUTxOs,
    projectCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    projectTN: "LOBSTER",
    projectAddress: treasuryAddress,
    scripts: {
      nodeValidator: newScripts.data.stakingValidator,
      stakingStake: newScripts.data.stakingStake,
      rewardFoldPolicy: newScripts.data.rewardPolicy,
      rewardFoldValidator: newScripts.data.rewardValidator,
    },
    refScripts: refScripts,
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const rewardFoldUnsigned3 = await rewardFold(lucid, rewardFoldConfig3);
  // console.log(rewardFoldUnsigned2);

  expect(rewardFoldUnsigned3.type).toBe("ok");
  if (rewardFoldUnsigned3.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const rewardFoldSigned3 = await rewardFoldUnsigned3.data.sign().complete();
  const rewardFoldHash3 = await rewardFoldSigned3.submit();

  emulator.awaitBlock(4);

  // REWARD FOLD 4

  const rewardFoldConfig4: RewardFoldConfig = {
    nodeInputs: nodeUTxOs,
    projectCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    projectTN: "LOBSTER",
    projectAddress: treasuryAddress,
    scripts: {
      nodeValidator: newScripts.data.stakingValidator,
      stakingStake: newScripts.data.stakingStake,
      rewardFoldPolicy: newScripts.data.rewardPolicy,
      rewardFoldValidator: newScripts.data.rewardValidator,
    },
    refScripts: refScripts,
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const rewardFoldUnsigned4 = await rewardFold(lucid, rewardFoldConfig4);

  expect(rewardFoldUnsigned4.type).toBe("ok");
  if (rewardFoldUnsigned4.type == "error") return;

  const rewardFoldSigned4 = await rewardFoldUnsigned4.data.sign().complete();
  const rewardFoldHash4 = await rewardFoldSigned4.submit();

  emulator.awaitBlock(4);

  logFlag ?
    console.log(
      "utxos at staking validator",
      await parseUTxOsAtScript(lucid, newScripts.data.stakingValidator)
    ) : null;

  // console.log(
  //   "users.treasury1.address",
  //   await lucid.utxosAt(users.treasury1.address)
  // );
  
  // console.log(
  //   "utxos at reward fold",
  //   await utxosAtScript(lucid, newScripts.data.rewardValidator)
  // );
  // console.log(
  //   "protocol fee address ",
  //   await lucid.utxosAt(lucid.utils.credentialToAddress(
  //     lucid.utils.keyHashToCredential(PROTOCOL_PAYMENT_KEY),
  //     lucid.utils.keyHashToCredential(PROTOCOL_STAKE_KEY)
  //   ))
  // );

  // MISSING REMOVE NODE WITH PROJECT TOKEN
});
