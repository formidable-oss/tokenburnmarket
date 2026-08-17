// @tokenburnmarket/core: pure domain logic shared by the web app and the Collector.
//
// Contract: mint curve (ADR 0004), LMSR market maker (ADR 0002), plausibility
// checks and Trust Levels (ADR 0003), Sync payload schema and Ed25519 signing.
// Nothing here touches the network, the filesystem, or the database, and the
// only runtime dependency is zod. Runs unchanged in Node and in the browser.
export const CORE_VERSION = "0.1.0";

// Trust Levels
export { TRUST_LEVELS, weakestTrustLevel } from "./trust";
export type { TrustLevel } from "./trust";

// Credit mint (ADR 0004)
export {
  CREDIT_DECIMALS,
  MINT_CURVE_VERSION,
  MINT_KINK_USD,
  MINT_TAIL_COEFFICIENT,
  REPORTED_MINT_MULTIPLIER,
  SIGNUP_GRANT_CREDITS,
  mintCurve,
  mintForDay,
  mintMultiplierFor,
  roundCredits,
  roundCreditsDown,
  roundCreditsUp,
} from "./mint";
export type { DailyMint } from "./mint";

// LMSR market maker (ADR 0002)
export {
  DEFAULT_SLIPPAGE_TOLERANCE,
  LMSR_GLOBAL_BASE,
  LMSR_GLOBAL_MAX,
  lmsrAdverseMove,
  lmsrCost,
  lmsrCostToBuy,
  lmsrHouseProfit,
  lmsrLiquidityForAudience,
  lmsrLiquidityForMembers,
  lmsrMaxHouseLoss,
  lmsrPrice,
  lmsrPrices,
  lmsrProceedsOfSell,
  lmsrQuote,
} from "./lmsr";
export type { LmsrQuote, TradeSide } from "./lmsr";

// Plausibility checks (ADR 0003)
export {
  DEFAULT_PLAUSIBILITY_LIMITS,
  checkPlausibility,
  resolvePlausibilityLimits,
} from "./plausibility";
export type {
  PlausibilityCode,
  PlausibilityContext,
  PlausibilityLimits,
  PlausibilityReason,
  PlausibilityResult,
  UsageDayInput,
} from "./plausibility";

// Canonical JSON and Ed25519 signing
export { CanonicalJsonError, canonicalBytes, canonicalJson } from "./canonical-json";
export type { CanonicalValue } from "./canonical-json";
export {
  SigningUnavailableError,
  fromBase64,
  generateDeviceKeyPair,
  signPayload,
  toBase64,
  verifyPayload,
} from "./signing";
export type { DeviceKeyPair } from "./signing";

// Sync payload
export {
  MAX_RECEIPTS_PER_DAY,
  MAX_SYNC_DAYS,
  ReceiptHashSchema,
  SYNC_PAYLOAD_VERSION,
  SignedSyncSchema,
  SyncDaySchema,
  SyncPayloadSchema,
  UtcDaySchema,
  createSignedSync,
  syncSigningInput,
  usageDayInputFromSyncDay,
  verifySyncBody,
} from "./sync";
export type { SignedSync, SyncDay, SyncPayload, SyncVerification } from "./sync";

// Market templates (CONTEXT.md): params, Outcomes and the rules sentence
export {
  ANOTHER_MODEL_LABEL,
  HeadToHeadParamsSchema,
  KNOWN_MODELS,
  MARKET_TEMPLATES,
  MAX_TEMPLATE_OUTCOMES,
  MODEL_RACE_MODELS,
  MarketPeriodSchema,
  MarketTemplateParamsSchema,
  ModelRaceParamsSchema,
  SOMEONE_ELSE_LABEL,
  TemplateBuilderSchema,
  TemplateScopeSchema,
  ThresholdParamsSchema,
  TopBurnerParamsSchema,
  autoMarketKey,
  buildHeadToHeadOutcomes,
  buildModelRaceOutcomes,
  buildTemplateOutcomes,
  buildThresholdOutcomes,
  buildTopBurnerOutcomes,
  formatDay,
  formatPeriodShort,
  formatUsd,
  marketTemplateQuestion,
  marketTemplateRulesText,
  nextUtcWeek,
  parseTemplateParams,
  periodClosesAt,
  utcWeekOf,
} from "./market-templates";
export type {
  HeadToHeadParams,
  MarketPeriod,
  MarketTemplate,
  MarketTemplateParams,
  MemberSnapshot,
  ModelRaceParams,
  OutcomeRef,
  TemplateBuilder,
  TemplateOutcome,
  TemplateScope,
  ThresholdParams,
  TopBurnerParams,
} from "./market-templates";
