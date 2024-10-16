import {
  createConfig,
  CreateConfig,
  initStaking,
  InitStakingConfig,
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
import alwaysFails from "./compiled/alwaysFails.json";
import {
  buildDeployFetchRefScripts,
  initializeLucidContext,
  LucidContext,
} from "./setup.js";

beforeEach<LucidContext>(initializeLucidContext);

test<LucidContext>("Test - initStaking - account1 insertNode - account2 insertNode \
 - account2 modifyNode - account1 modifyNode", async ({
  lucid,
  users,
  emulator,
}) => {
  const logFlag = false;


  // const [treasuryUTxO] = await lucid
  //   .selectWalletFrom({ address: users.treasury1.address })
  //   .wallet.getUtxos();
  
  const treasuryAddress = users.treasury1.address;
  const [treasuryUTxO] = await lucid.config().provider.getUtxos(treasuryAddress);

  // const [configUTxO] = await lucid
  //   .selectWalletFrom({ address: users.account1.address })
  //   .wallet.getUtxos();

  const accountAddress = users.account1.address;
  const [configUTxO] = await lucid.config().provider.getUtxos(accountAddress);

  const currentTime = emulator.now();

  // DEPLOY
  lucid.selectWallet.fromSeed(users.account3.seedPhrase);
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

  lucid.selectWallet.fromSeed(users.account1.seedPhrase);
  const createConfigUnsigned = await createConfig(lucid, createConfigObj);

  expect(createConfigUnsigned.type).toBe("ok");
  if (createConfigUnsigned.type == "error") return;
  const createConfigSigned = await createConfigUnsigned.data.tx
    .sign.withWallet()
    .complete();
  await createConfigSigned.submit();

  const configTN = createConfigUnsigned.data.configTN;

  emulator.awaitBlock(4);

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

  lucid.selectWallet.fromSeed(users.treasury1.seedPhrase);
  const initStakingUnsigned = await initStaking(lucid, initStakingConfig);
  // console.log(initStakingUnsigned);

  expect(initStakingUnsigned.type).toBe("ok");
  if (initStakingUnsigned.type == "error") return;
  // console.log(tx.data.txComplete.to_json())
  const initStakingSigned = await initStakingUnsigned.data.sign.withWallet().complete();
  await initStakingSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "initStaking result ",
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

  // INSERT NODE ACCOUNT 1

  const insertNodeConfig: InsertNodeConfig = {
    configTN: configTN,
    refScripts: refUTxOs,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000_000_000_000,
    toStake: 1_001_000_000_000,
    freezeStake: currentTime + ONE_HOUR_MS,
    currentTime: emulator.now(),
  };

  lucid.selectWallet.fromSeed(users.account1.seedPhrase);
  const insertNodeUnsigned = await insertNode(lucid, insertNodeConfig);
  // console.log(insertNodeUnsigned);

  expect(insertNodeUnsigned.type).toBe("ok");
  if (insertNodeUnsigned.type == "error") return;

  const insertNodeSigned = await insertNodeUnsigned.data.sign.withWallet().complete();
  const insertNodeHash = await insertNodeSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "insertNode result",
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

  // INSERT NODE ACCOUNT 2

  const insertNodeConfig2: InsertNodeConfig = {
    configTN: configTN,
    refScripts: refUTxOs,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000_000_000_000,
    toStake: 1_002_000_000_000,
    freezeStake: currentTime + ONE_HOUR_MS,
    currentTime: emulator.now(),
  };

  lucid.selectWallet.fromSeed(users.account2.seedPhrase);
  const insertNodeUnsigned2 = await insertNode(lucid, insertNodeConfig2);

  expect(insertNodeUnsigned2.type).toBe("ok");
  if (insertNodeUnsigned2.type == "error") return;

  const insertNodeSigned2 = await insertNodeUnsigned2.data.sign.withWallet().complete();
  const insertNodeHash2 = await insertNodeSigned2.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "insertNode result",
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

  // MODIFY NODE ACCOUNT 2

  const modifyNodeConfig: InsertNodeConfig = {
    configTN: configTN,
    refScripts: refUTxOs,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000_000_000_000,
    toStake: 1_022_000_000_000,
    freezeStake: currentTime + ONE_HOUR_MS,
    currentTime: emulator.now(),
  };

  lucid.selectWallet.fromSeed(users.account2.seedPhrase);
  const modifyNodeUnsigned = await modifyNode(lucid, modifyNodeConfig);
  // console.log(modifyNodeUnsigned);

  expect(modifyNodeUnsigned.type).toBe("ok");
  if (modifyNodeUnsigned.type == "error") return;

  const modifyNodeSigned = await modifyNodeUnsigned.data.sign.withWallet().complete();
  const modifyNodeHash = await modifyNodeSigned.submit();

  emulator.awaitBlock(4);

  // MODIFY NODE ACCOUNT 1

  const modifyNodeConfig2: InsertNodeConfig = {
    configTN: configTN,
    refScripts: refUTxOs,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000_000_000_000,
    toStake: 1_000_000_000_000,
    freezeStake: currentTime + ONE_HOUR_MS,
    currentTime: emulator.now(),
  };

  lucid.selectWallet.fromSeed(users.account1.seedPhrase);
  const modifyNodeUnsigned2 = await modifyNode(lucid, modifyNodeConfig2);
  // console.log(modifyNodeUnsigned2);

  expect(modifyNodeUnsigned2.type).toBe("ok");
  if (modifyNodeUnsigned2.type == "error") return;

  const modifyNodeSigned2 = await modifyNodeUnsigned2.data.sign.withWallet().complete();
  const modifyNodeHash2 = await modifyNodeSigned2.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "modify node result",
        await parseUTxOsAtScript(
          lucid,
          refUTxOs.nodeValidator.scriptRef?.script!,
          SetNode,
        ),
      )
    : null;
});
