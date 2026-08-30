/**
 * The RevenueCat surface. Every call site the architecture claims lives here.
 *
 * Delete RevenueCat and there is no COIN, no Angler's Pass and no lake economy
 * — not a degraded game, no game. That is the point: the SDK is the engine, not
 * a purchase button bolted onto the end.
 *
 * The one rule this file never breaks: the client reads balances, it never
 * writes them. Every grant and every spend goes through the Worker, because
 * Virtual Currency transactions must be initiated server-side over an
 * authenticated channel.
 */

import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';

export const ENTITLEMENT_ANGLERS_PASS = 'anglers_pass';
export const VC_COIN = 'COIN';

/** 1. Purchases.configure — establishes the RevenueCat customer at app launch. */
export async function configurePurchases(apiKey: string, appUserId: string): Promise<void> {
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);

  // appUserID is passed at configure time so there is never a window where an
  // anonymous customer could take a purchase that then has to be transferred.
  Purchases.configure({ apiKey, appUserID: appUserId });
}

/**
 * 2. Purchases.logIn — binds the RevenueCat customer to our stable id.
 *
 * The SAME id is passed to OneSignal.login(). That single shared id is what
 * lets a Journey target "this player unlocked Deep Sea three days ago and has
 * not opened since" — the targeting reads state that only exists because the
 * identity graph is unified.
 */
export async function loginPurchases(appUserId: string): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.logIn(appUserId);
  return customerInfo;
}

/** 3. getOfferings — the Tackle Shop renders from this, never from a local price list. */
export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  const offerings = await Purchases.getOfferings();
  return offerings.current ?? null;
}

/** 4. purchasePackage — coin packs and the Angler's Pass subscription. */
export async function buyPackage(pkg: PurchasesPackage): Promise<CustomerInfo | null> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return customerInfo;
  } catch (e: any) {
    // A user cancelling is a normal outcome, not an error to surface as one.
    if (e?.userCancelled) return null;
    throw e;
  }
}

/**
 * 5. virtualCurrencies — the wallet HUD.
 *
 * Always invalidate first when reading after a server-side movement: the SDK
 * caches, and a stale read would show the player a balance the server has
 * already changed. The whole "server-settled" claim is only legible if the HUD
 * reflects the server rather than a local counter.
 */
export async function readCoinBalance({ fresh = false } = {}): Promise<number | null> {
  if (fresh) await Purchases.invalidateVirtualCurrenciesCache();
  const currencies = await Purchases.getVirtualCurrencies();
  const coin = currencies.all?.[VC_COIN];
  return typeof coin?.balance === 'number' ? coin.balance : null;
}

/**
 * 6. presentPaywallIfNeeded — the Deep Sea tap.
 *
 * The paywall is designed in the RevenueCat dashboard, so this app ships zero
 * paywall UI. Less code, and it makes the RevenueCat surface visually
 * identifiable to a judge who knows the product.
 */
export async function presentAnglersPassPaywall(): Promise<boolean> {
  await RevenueCatUI.presentPaywallIfNeeded({
    requiredEntitlementIdentifier: ENTITLEMENT_ANGLERS_PASS,
  });
  return hasAnglersPass(await Purchases.getCustomerInfo());
}

/** 7. entitlements.active — the gate check wherever premium content renders. */
export function hasAnglersPass(info: CustomerInfo | null): boolean {
  return Boolean(info?.entitlements.active[ENTITLEMENT_ANGLERS_PASS]);
}

/** 8. restorePurchases — reinstall and device-swap continuity. */
export async function restore(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

export async function getCustomerInfo(): Promise<CustomerInfo> {
  return Purchases.getCustomerInfo();
}

/** Listen for entitlement changes (a trial converting, a subscription expiring). */
export function onCustomerInfoChanged(cb: (info: CustomerInfo) => void): () => void {
  Purchases.addCustomerInfoUpdateListener(cb);
  return () => Purchases.removeCustomerInfoUpdateListener(cb);
}

/** Split an offering's packages into the two shop sections the UI renders. */
export function splitPackages(offering: PurchasesOffering | null) {
  const all = offering?.availablePackages ?? [];
  return {
    coinPacks: all.filter((p) => p.product.identifier.startsWith('coins_')),
    pass: all.find((p) => p.product.identifier.includes('anglers_pass')) ?? null,
  };
}
