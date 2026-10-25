/*
  A Builder's Devices as /settings lists them: every one ever approved, revoked
  ones included, because a revoked Device's Usage still counts and may still
  need to be marked as the same machine as a newer one.
*/
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { devices, usageDays } from "@/db/schema";

/** The form value for "a machine of its own" in the machine picker. */
export const OWN_MACHINE = "own";

export interface DeviceSummary {
  id: string;
  name: string;
  createdAt: Date;
  lastSyncAt: Date | null;
  revokedAt: Date | null;
  machineId: string;
  /** Whether this Device's token may place bets. */
  canTrade: boolean;
  /** The first and last UTC day this Device uploaded, or null before its first Sync. */
  firstDay: string | null;
  lastDay: string | null;
  /** Estimated cost of this Device's rows that count: not a duplicate, not Quarantined. */
  countedCostUsd: number;
}

export async function devicesWithUsage(builderId: string): Promise<DeviceSummary[]> {
  const usage = db
    .select({
      deviceId: usageDays.deviceId,
      firstDay: sql<string>`min(${usageDays.day})`.as("first_day"),
      lastDay: sql<string>`max(${usageDays.day})`.as("last_day"),
      countedCostUsd: sql<string>`sum(${usageDays.costUsd}) filter (
        where ${usageDays.duplicateOfDeviceId} is null and ${usageDays.trustLevel} <> 'quarantined'
      )`.as("counted_cost_usd"),
    })
    .from(usageDays)
    .where(eq(usageDays.builderId, builderId))
    .groupBy(usageDays.deviceId)
    .as("usage");

  const rows = await db
    .select({
      id: devices.id,
      name: devices.name,
      createdAt: devices.createdAt,
      lastSyncAt: devices.lastSyncAt,
      revokedAt: devices.revokedAt,
      machineId: devices.machineId,
      canTrade: devices.canTrade,
      firstDay: usage.firstDay,
      lastDay: usage.lastDay,
      countedCostUsd: usage.countedCostUsd,
    })
    .from(devices)
    .leftJoin(usage, eq(usage.deviceId, devices.id))
    .where(eq(devices.builderId, builderId))
    .orderBy(devices.createdAt, devices.name, devices.id);

  return rows.map((row) => ({ ...row, countedCostUsd: Number(row.countedCostUsd ?? 0) }));
}

/**
 * The Device another one is shown as sharing a machine with: the oldest other
 * Device on the same machine, or null when it is a machine of its own.
 */
export function machinePeer(device: DeviceSummary, all: readonly DeviceSummary[]): DeviceSummary | null {
  return all.find((other) => other.id !== device.id && other.machineId === device.machineId) ?? null;
}
