import {
  Address,
  applyDoubleCborEncoding,
  Assets,
  Constr,
  Data,
  fromText,
  generateSeedPhrase,
  getAddressDetails,
  Lucid,
  MintingPolicy,
  SpendingValidator,
} from "@anastasia-labs/lucid-cardano-fork";
import { SETNODE_PREFIX } from "../constants.js";
import { AddressD } from "../contract.types.js";
import { Result } from "../types.js";

export const toCBORHex = (rawHex: string) => {
  return applyDoubleCborEncoding(rawHex);
};

export const generateAccountSeedPhrase = async (assets: Assets) => {
  const seedPhrase = generateSeedPhrase();
  return {
    seedPhrase,
    address: await (await Lucid.new(undefined, "Custom"))
      .selectWalletFromSeed(seedPhrase)
      .wallet.address(),
    assets,
  };
};

export function fromAddress(address: Address): AddressD {
  // We do not support pointer addresses!

  const { paymentCredential, stakeCredential } = getAddressDetails(address);

  if (!paymentCredential) throw new Error("Not a valid payment address.");

  return {
    paymentCredential:
      paymentCredential?.type === "Key"
        ? {
            PublicKeyCredential: [paymentCredential.hash],
          }
        : { ScriptCredential: [paymentCredential.hash] },
    stakeCredential: stakeCredential
      ? {
          Inline: [
            stakeCredential.type === "Key"
              ? {
                  PublicKeyCredential: [stakeCredential.hash],
                }
              : { ScriptCredential: [stakeCredential.hash] },
          ],
        }
      : null,
  };
}

export function toAddress(address: AddressD, lucid: Lucid): Address {
  const paymentCredential = (() => {
    if ("PublicKeyCredential" in address.paymentCredential) {
      return lucid.utils.keyHashToCredential(
        address.paymentCredential.PublicKeyCredential[0]
      );
    } else {
      return lucid.utils.scriptHashToCredential(
        address.paymentCredential.ScriptCredential[0]
      );
    }
  })();
  const stakeCredential = (() => {
    if (!address.stakeCredential) return undefined;
    if ("Inline" in address.stakeCredential) {
      if ("PublicKeyCredential" in address.stakeCredential.Inline[0]) {
        return lucid.utils.keyHashToCredential(
          address.stakeCredential.Inline[0].PublicKeyCredential[0]
        );
      } else {
        return lucid.utils.scriptHashToCredential(
          address.stakeCredential.Inline[0].ScriptCredential[0]
        );
      }
    } else {
      return undefined;
    }
  })();
  return lucid.utils.credentialToAddress(paymentCredential, stakeCredential);
}

export function mkNodeKeyTN(tokenName: string) {
  return fromText(SETNODE_PREFIX) + tokenName;
}

export const fromAddressToData = (address: Address): Result<Data> => {
  const addrDetails = getAddressDetails(address);

  if (!addrDetails.paymentCredential)
    return { type: "error", error: new Error("undefined paymentCredential") };

  const paymentCred =
    addrDetails.paymentCredential.type == "Key"
      ? new Constr(0, [addrDetails.paymentCredential.hash])
      : new Constr(1, [addrDetails.paymentCredential.hash]);

  if (!addrDetails.stakeCredential)
    return {
      type: "ok",
      data: new Constr(0, [paymentCred, new Constr(1, [])]),
    };

  const stakingCred = new Constr(0, [
    new Constr(0, [new Constr(0, [addrDetails.stakeCredential.hash])]),
  ]);

  return { type: "ok", data: new Constr(0, [paymentCred, stakingCred]) };
};

type MintingPolicyDetails = {
  mintingPolicy: MintingPolicy;
  mintingPolicyId: string;
};
type SpendingValidatorDetails = {
  spendingValidator: SpendingValidator;
  spendingValidatorAddress: Address;
};



// const tokenHolderValidator: SpendingValidator = {
//   type: "PlutusV2",
//   script: config.scripts.tokenHolderValidator,
// };
//
// const tokenHolderValidatorAddr =
//   lucid.utils.validatorToAddress(tokenHolderValidator);
//
// const tokenHolderPolicy: MintingPolicy = {
//   type: "PlutusV2",
//   script: config.scripts.tokenHolderPolicy,
// };
// const tokenHolderPolicyId = lucid.utils.mintingPolicyToId(tokenHolderPolicy);
