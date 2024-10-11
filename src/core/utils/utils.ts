import {
  addAssets,
  Address,
  applyDoubleCborEncoding,
  Assets,
  Constr,
  credentialToAddress,
  Data,
  Emulator,
  fromHex,
  fromText,
  generateSeedPhrase,
  getAddressDetails,
  keyHashToCredential,
  Lucid,
  LucidEvolution,
  scriptHashToCredential,
  toHex,
  UTxO,
} from "@lucid-evolution/lucid";
import { SETNODE_PREFIX } from "../constants.js";
import { AddressD } from "../contract.types.js";
import { Result } from "../types.js";

export const toCBORHex = (rawHex: string) => {
  return applyDoubleCborEncoding(rawHex);
};

export const generateAccountSeedPhrase = async (assets: Assets) => {
  const seedPhrase = generateSeedPhrase();
  const lucid = await Lucid(new Emulator([]), "Custom");
  lucid.selectWallet.fromSeed(seedPhrase);
  const address = lucid.wallet().address;
  return {
    seedPhrase,
    address,
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

export function toAddress(address: AddressD, lucid: LucidEvolution): Address {
  const network = lucid.config().network;
  const paymentCredential = (() => {
    if ("PublicKeyCredential" in address.paymentCredential) {
      return keyHashToCredential(
        address.paymentCredential.PublicKeyCredential[0],
      );
    } else {
      return scriptHashToCredential(
        address.paymentCredential.ScriptCredential[0],
      );
    }
  })();
  const stakeCredential = (() => {
    if (!address.stakeCredential) return undefined;
    if ("Inline" in address.stakeCredential) {
      if ("PublicKeyCredential" in address.stakeCredential.Inline[0]) {
        return keyHashToCredential(
          address.stakeCredential.Inline[0].PublicKeyCredential[0],
        );
      } else {
        return scriptHashToCredential(
          address.stakeCredential.Inline[0].ScriptCredential[0],
        );
      }
    } else {
      return undefined;
    }
  })();
  return credentialToAddress(network,paymentCredential, stakeCredential);
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

/**
 * Returns a list of UTxOs whose total assets are equal to or greater than the asset value provided
 * @param utxos list of available utxos
 * @param minAssets minimum total assets required
 */
export function selectUtxos(utxos: UTxO[], minAssets: Assets): Result<UTxO[]> {
  const selectedUtxos: UTxO[] = [];
  let isSelected = false;
  const assetsRequired = new Map<string, bigint>(Object.entries(minAssets));

  for (const utxo of utxos) {
    if (utxo.scriptRef) {
      // not selecting utxos with scriptRef
      continue;
    }

    isSelected = false;

    for (const [unit, value] of assetsRequired) {
      if (Object.hasOwn(utxo.assets, unit)) {
        const utxoValue = utxo.assets[unit];

        if (utxoValue >= value) {
          assetsRequired.delete(unit);
        } else {
          assetsRequired.set(unit, value - utxoValue);
        }

        isSelected = true;
      }
    }

    if (isSelected) {
      selectedUtxos.push(utxo);
    }
    if (assetsRequired.size == 0) {
      break;
    }
  }

  if (assetsRequired.size > 0) {
    return { type: "error", error: new Error(`Insufficient funds`) };
  }

  return { type: "ok", data: selectedUtxos };
}

export function getInputUtxoIndices(
  indexInputs: UTxO[],
  remainingInputs: UTxO[],
): bigint[] {
  const allInputs = indexInputs.concat(remainingInputs);

  const sortedInputs = sortUTxOsByOutRefWithIndex(allInputs);
  const indicesMap = new Map<string, bigint>();

  sortedInputs.forEach((value, index) => {
    indicesMap.set(value.txHash + value.outputIndex, BigInt(index));
  });

  return indexInputs.flatMap((value) => {
    const index = indicesMap.get(value.txHash + value.outputIndex);
    if (index !== undefined) return index;
    else return [];
  });
}

export function sortUTxOsByOutRefWithIndex(utxos: UTxO[]): UTxO[] {
  return utxos.sort((a, b) => {
    if (a.txHash < b.txHash) {
      return -1;
    } else if (a.txHash > b.txHash) {
      return 1;
    } else if (a.txHash == b.txHash) {
      if (a.outputIndex < b.outputIndex) {
        return -1;
      } else return 1;
    } else return 0;
  });
}

export function sumUtxoAssets(utxos: UTxO[]): Assets {
  return utxos
    .map((utxo) => utxo.assets)
    .reduce((acc, assets) => addAssets(acc, assets), {});
}

/** Remove the intersection of a & b asset quantities from a
 * @param a assets to be removed from
 * @param b assets to remove
 * For e.g.
 * a = {[x] : 5n, [y] : 10n}
 * b = {[x] : 3n, [y] : 15n, [z] : 4n}
 * remove(a, b) = {[x] : 2n}
 */
export function remove(a: Assets, b: Assets): Assets {
  for (const [key, value] of Object.entries(b)) {
    if (Object.hasOwn(a, key)) {
      if (a[key] < value) delete a[key];
      else if (a[key] > value) a[key] -= value;
      else delete a[key];
    }
  }

  return a;
}

/**
 * Returns a unique token name using a Utxo's txid and idx
 * @param utxo UTxO whose OutRef will be used
 */
export async function getUniqueTokenName(utxo: UTxO): Promise<string> {
  const id = fromHex(utxo.txHash);
  const data = new Uint8Array([utxo.outputIndex, ...id]);

  const hash = new Uint8Array(await crypto.subtle.digest("SHA3-256", data));

  return toHex(hash);
}
