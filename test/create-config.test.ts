import {
  createConfig,
  CreateConfig,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  replacer,
  SpendingValidator,
  StakingConfig,
  toUnit,
  TWENTY_FOUR_HOURS_MS,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import alwaysFails from "./compiled/alwaysFails.json";
import tokenHolderValidator from "./compiled/tokenHolderValidator.json";
import {
  buildDeployFetchRefScripts,
  initializeLucidContext,
  LucidContext,
} from "./setup.js";

beforeEach<LucidContext>(initializeLucidContext);

test<LucidContext>("Test - initNode - account1 insertNode - account2 insertNode - account3 insertNode - treasury1 initFold", async ({
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
  const [configUTxO] = await lucid
    .selectWalletFrom({ address: users.account1.address })
    .wallet.getUtxos();

  const currentTime = emulator.now();

  // DEPLOY
  lucid.selectWalletFromSeed(users.account3.seedPhrase);
  const refUTxOsRes = await buildDeployFetchRefScripts(lucid, emulator);

  expect(refUTxOsRes.type).toBe("ok");
  if (refUTxOsRes.type == "error") return;
  const refUTxOs = refUTxOsRes.data;

  // FAILED CREATE CONFIG 1
  const createConfigObj1: CreateConfig = {
    stakingConfig: {
      stakingInitUTXO: treasuryUTxO,
      rewardInitUTXO: reward1UTxO,
      freezeStake: currentTime + ONE_HOUR_MS,
      endStaking: currentTime + ONE_HOUR_MS + TWENTY_FOUR_HOURS_MS,
      penaltyAddress: users.treasury1.address,
      stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      stakeTN: "MIN",
      minimumStake: 1_000,
      rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      rewardTN: "MIN",
    },
    configInitUTXO: configUTxO,
    refScripts: {
      configPolicy: refUTxOs.configPolicy,
    },
    alwaysFails: tokenHolderValidator.cborHex,
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.account1.seedPhrase);
  const createConfigUnsigned1 = await createConfig(lucid, createConfigObj1);
  // console.log(createConfigUnsigned1);

  expect(createConfigUnsigned1.type).toBe("error");
  if (createConfigUnsigned1.type == "ok") return;

  emulator.awaitBlock(4);

  // CREATE CONFIG 2
  const createConfigObj2: CreateConfig = {
    ...createConfigObj1,
    alwaysFails: alwaysFails.cborHex,
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.account1.seedPhrase);
  const createConfigUnsigned2 = await createConfig(lucid, createConfigObj2);
  // console.log(createConfigUnsigned2);

  expect(createConfigUnsigned2.type).toBe("ok");
  if (createConfigUnsigned2.type == "error") return;
  const createConfigSigned2 = await createConfigUnsigned2.data.tx
    .sign()
    .complete();
  await createConfigSigned2.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "Create Config Result",
        JSON.stringify(
          await parseUTxOsAtScript(lucid, alwaysFails.cborHex, StakingConfig),
          replacer,
          2,
        ),
      )
    : null;

  // TODO Test for datum type not conforming to PStakingConfig
  // const alwaysFailsScript: SpendingValidator = {
  //   type: "PlutusV2",
  //   script: alwaysFails.cborHex,
  // };
  // const alwaysFailsAddr = lucid.utils.validatorToAddress(alwaysFailsS);
  // console.log(
  //   await lucid.utxosAtWithUnit(
  //     alwaysFailsAddr,
  //     toUnit(
  //       lucid.utils.mintingPolicyToId(refUTxOs.configPolicy.scriptRef!),
  //       createConfigUnsigned2.data.configTN,
  //     ),
  //   ),
  // );
});
