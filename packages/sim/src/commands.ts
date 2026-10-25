// Phase 0: command validation and application (specification §2, Commands and Command validation).
import { armyPath, disbandArmy, planningOrigin, returnSoldiers } from "./army";
import { resolvePolicies, settleRealm, transferArea, upsertSetting } from "./government";
import type { Path } from "./graph";
import { canBuild, INFRASTRUCTURE_KINDS, kindIndex, levelOf } from "./infrastructure";
import { EPSILON } from "./math";
import { lowerInfrastructure } from "./tick/infrastructure";
import { takeWorkers } from "./tick/population";
import type {
  Area,
  AreaId,
  Army,
  Command,
  CommandEnvelope,
  Government,
  GovernmentAreaState,
  GovernmentJob,
  PeaceProposal,
  PolicyName,
  PolicySetting,
  StandingRule,
  World,
} from "./types";
import { extractionCapacityMaximum } from "./waters";

/** Player id under which AI governments send their commands; the host never accepts it from the network. */
export const AI_PLAYER = "ai";
export const MAXIMUM_MARKET_ORDERS = 1000;
export const MAXIMUM_STANDING_ORDERS = 200;
const MINIMUM_TAX_RATE = -1;
const MAXIMUM_TAX_RATE = 5;
const MAXIMUM_WAGE_OFFER = 10;
const MAXIMUM_STAFF_WAGE_SHARE = 5;

const PER_GOOD_POLICIES: readonly PolicyName[] = [
  "productionTaxRate",
  "consumptionTaxRate",
  "importTariffRate",
  "exportTariffRate",
  "priceCeiling",
  "priceFloor",
];
const RATE_POLICIES: readonly PolicyName[] = [
  "productionTaxRate",
  "consumptionTaxRate",
  "importTariffRate",
  "exportTariffRate",
];

export interface CommandRejection {
  envelope: CommandEnvelope;
  reason: string;
}

/** Validates and applies commands in order; each sees the state left by the ones before it. */
export function applyCommands(world: World, envelopes: readonly CommandEnvelope[]): CommandRejection[] {
  const rejections: CommandRejection[] = [];
  for (const envelope of envelopes) {
    const reason = applyCommand(world, envelope);
    if (reason !== null) rejections.push({ envelope, reason });
  }
  return rejections;
}

/** Applies one command if it is valid. Returns null on success, or the reason it was rejected. */
export function applyCommand(world: World, envelope: CommandEnvelope): string | null {
  const reason = validateCommand(world, envelope);
  if (reason !== null) return reason;
  execute(world, world.governments[envelope.government] as Government, envelope.command);
  return null;
}

// Validation

const isIndex = (value: unknown, length: number): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < length;
const isAmount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Returns null when the command is valid for the sending government, or the reason it is not. */
export function validateCommand(world: World, envelope: CommandEnvelope): string | null {
  if (!isIndex(envelope.government, world.governments.length)) return "unknown government";
  const government = world.governments[envelope.government] as Government;
  const sender = government.controller.kind === "human" ? government.controller.player : AI_PLAYER;
  if (envelope.player !== sender) return "sender does not control this government";
  if (government.isEliminated) return "government is eliminated";
  const command = envelope.command as Command | undefined;
  if (!command || typeof command !== "object") return "malformed command";
  return validate(world, government, command);
}

function validate(world: World, government: Government, command: Command): string | null {
  switch (command.type) {
    case "setRealmPolicy":
      return validateSetting(world, command.setting);
    case "setAreaPolicy":
      return ownedState(world, government, command.area).reason ?? validateSetting(world, command.setting);
    case "clearAreaPolicy":
      return (
        ownedState(world, government, command.area).reason ??
        validateSetting(world, { policy: command.policy, good: command.good, value: null })
      );
    case "placeMarketOrder": {
      const { order } = command;
      if (!order || typeof order !== "object") return "malformed order";
      const reason = ownedState(world, government, order.area).reason ?? validateGood(world, order.good);
      if (reason) return reason;
      if (order.side !== "buy" && order.side !== "sell") return "side must be buy or sell";
      if (![order.remainingQuantity, order.limitPrice, order.maximumQuantityPerDay].every(isAmount))
        return "quantities and prices must be finite and non-negative";
      if (government.marketOrders.length >= MAXIMUM_MARKET_ORDERS) return "too many open market orders";
      return null;
    }
    case "cancelMarketOrder":
      return government.marketOrders.some((order) => order.id === command.orderId) ? null : "no such market order";
    case "setJobTarget": {
      const { state, reason } = ownedState(world, government, command.area);
      if (!state) return reason;
      if (!isAmount(command.targetWorkers)) return "worker target must be finite and non-negative";
      return validateJob(world, world.areas[command.area] as Area, command.job);
    }
    case "setWageOffer": {
      const reason = ownedState(world, government, command.area).reason;
      if (reason) return reason;
      if (!isAmount(command.wageOffer) || command.wageOffer > MAXIMUM_WAGE_OFFER)
        return `wage offer must be within [0, ${MAXIMUM_WAGE_OFFER}]`;
      return null;
    }
    case "setInfrastructureTarget": {
      const reason = ownedState(world, government, command.area).reason;
      if (reason) return reason;
      if (!INFRASTRUCTURE_KINDS.includes(command.kind)) return "unknown infrastructure";
      const maximum = world.config.infrastructure.maximumLevel;
      if (!Number.isInteger(command.level) || command.level < 0 || command.level > maximum)
        return `level must be a whole number within [0, ${maximum}]`;
      if (command.level > 0 && !canBuild(world.areas[command.area] as Area, command.kind))
        return "ports can only be built in coastal areas";
      return null;
    }
    case "addStandingOrder": {
      const { order } = command;
      if (!order || typeof order !== "object") return "malformed order";
      if (order.areas !== "all") {
        if (!Array.isArray(order.areas)) return "areas must be a list or all";
        for (const area of order.areas) {
          const reason = ownedState(world, government, area).reason;
          if (reason) return reason;
        }
      }
      const reason = validateRule(world, order.rule);
      if (reason) return reason;
      if (government.standingOrders.length >= MAXIMUM_STANDING_ORDERS) return "too many standing orders";
      return null;
    }
    case "removeStandingOrder":
      return government.standingOrders.some((order) => order.id === command.orderId) ? null : "no such standing order";
    case "recruitArmy": {
      const reason = ownedState(world, government, command.area).reason;
      if (reason) return reason;
      if (!isAmount(command.soldiers) || command.soldiers < 1) return "an army needs at least one soldier";
      const area = world.areas[command.area] as Area;
      let available = area.unemployedWorkers;
      for (const good of world.goods) available += area.privateWorkers[good.id] as number;
      return command.soldiers > available ? "not enough unemployed and private workers" : null;
    }
    case "disbandArmy": {
      const { army, reason } = ownArmy(world, government, command.army);
      if (!army) return reason;
      if (!isAmount(command.soldiers) || command.soldiers > army.soldiers)
        return "soldiers must be between 0 and the size of the army";
      return null;
    }
    case "moveArmy": {
      const { army, reason } = ownArmy(world, government, command.army);
      if (!army) return reason;
      if (!isIndex(command.destination, world.areas.length)) return "unknown area";
      return armyPath(world, government.id, planningOrigin(world, army), command.destination)
        ? null
        : "the army cannot reach this area";
    }
    case "setArmyStance": {
      const { army, reason } = ownArmy(world, government, command.army);
      if (!army) return reason;
      return command.stance === "hold" || command.stance === "attack" ? null : "stance must be hold or attack";
    }
    case "setSoldierWage":
      return isAmount(command.wage) && command.wage <= MAXIMUM_WAGE_OFFER
        ? null
        : `soldier wage must be within [0, ${MAXIMUM_WAGE_OFFER}]`;
    case "declareWar": {
      if (!isIndex(command.target, world.governments.length)) return "unknown government";
      if (command.target === government.id) return "a government cannot declare war on itself";
      if (world.governments[command.target]?.isEliminated) return "that government is eliminated";
      return world.relations[government.id]?.[command.target] === "war" ? "already at war" : null;
    }
    case "proposePeace":
      return validateProposal(world, government, command.proposal);
    case "answerPeace": {
      const proposal = world.peaceProposals.find((p) => p.id === command.proposalId);
      if (!proposal || proposal.to !== government.id) return "no such peace proposal";
      if (!command.accept) return null;
      const reason = validateTransfers(world, proposal);
      if (reason) return `the proposal is no longer valid: ${reason}`;
      const payer = world.governments[proposal.payment >= 0 ? proposal.from : proposal.to] as Government;
      return Math.abs(proposal.payment) > payer.treasury ? "the treasury of the payer cannot cover the payment" : null;
    }
    default:
      return "unknown command";
  }
}

function ownedState(
  world: World,
  government: Government,
  area: AreaId,
): { state: GovernmentAreaState; reason: null } | { state: null; reason: string } {
  if (!isIndex(area, world.areas.length)) return { state: null, reason: "unknown area" };
  const state = government.areaStates.get(area);
  return state ? { state, reason: null } : { state: null, reason: "area is not owned by this government" };
}

function validateGood(world: World, good: unknown): string | null {
  if (!isIndex(good, world.goods.length)) return "unknown good";
  if (world.goods[good]?.isService) return "services cannot be stored or traded by a government";
  return null;
}

function validateSetting(world: World, setting: PolicySetting): string | null {
  if (!setting || typeof setting !== "object") return "malformed policy setting";
  const { policy, good, value } = setting;
  if (policy === "headTaxPerPersonPerDay") {
    if (good !== null) return "head tax applies to an area, not a good";
    // A negative head tax is an allowance the treasury pays every inhabitant.
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) return "head tax must be finite";
    return null;
  }
  if (policy === "staffWageShare") {
    if (good !== null) return "the staff wage applies to an area, not a good";
    if (value !== null && (!isAmount(value) || value > MAXIMUM_STAFF_WAGE_SHARE))
      return `the staff wage must be within [0, ${MAXIMUM_STAFF_WAGE_SHARE}] times the local wage`;
    return null;
  }
  if (!PER_GOOD_POLICIES.includes(policy)) return "unknown policy";
  if (good !== null && !isIndex(good, world.goods.length)) return "unknown good"; // null: every good
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return "policy value must be finite";
  if (RATE_POLICIES.includes(policy)) {
    if (value < MINIMUM_TAX_RATE || value > MAXIMUM_TAX_RATE)
      return `tax rates must be within [${MINIMUM_TAX_RATE}, ${MAXIMUM_TAX_RATE}]`;
  } else if (value < 0) return "prices must be non-negative";
  return null;
}

function validateJob(world: World, area: Area, job: GovernmentJob): string | null {
  if (!job || typeof job !== "object") return "malformed job";
  if (job.kind !== "produce") return "unknown job"; // infrastructure is built with setInfrastructureTarget
  if (!isIndex(job.good, world.goods.length)) return "unknown good";
  const good = world.goods[job.good] as World["goods"][number];
  if (good.isService) return "a government cannot produce a service";
  if (good.isPrimary && extractionCapacityMaximum(world, area, good.id) <= 0)
    return "the area has no natural capacity for this good";
  return null;
}

function validateRule(world: World, rule: StandingRule): string | null {
  if (!rule || typeof rule !== "object") return "malformed rule";
  switch (rule.kind) {
    case "keepDepotStock":
      return (
        validateGood(world, rule.good) ??
        ([rule.targetDaysOfDemand, rule.maximumBuyPrice].every(isAmount) ? null : "numbers must be non-negative")
      );
    case "sellAbovePrice":
      return (
        validateGood(world, rule.good) ??
        ([rule.minimumPrice, rule.keepDaysOfDemand].every(isAmount) ? null : "numbers must be non-negative")
      );
    case "buyBelowPrice":
      return (
        validateGood(world, rule.good) ??
        ([rule.maximumPrice, rule.maximumDepotQuantity].every(isAmount) ? null : "numbers must be non-negative")
      );
    default:
      return "unknown rule";
  }
}

function ownArmy(
  world: World,
  government: Government,
  id: number,
): { army: Army; reason: null } | { army: null; reason: string } {
  const army = world.armies.get(id);
  return army && army.owner === government.id
    ? { army, reason: null }
    : { army: null, reason: "army does not belong to this government" };
}

function validateProposal(world: World, government: Government, proposal: Omit<PeaceProposal, "id">): string | null {
  if (!proposal || typeof proposal !== "object") return "malformed proposal";
  if (proposal.from !== government.id) return "a proposal must come from the sending government";
  if (!isIndex(proposal.to, world.governments.length) || proposal.to === proposal.from) return "unknown government";
  if (world.relations[proposal.from]?.[proposal.to] !== "war") return "peace is proposed only to a government at war";
  if (typeof proposal.payment !== "number" || !Number.isFinite(proposal.payment)) return "payment must be finite";
  if (typeof proposal.expiresAtDay !== "number" || !(proposal.expiresAtDay > world.gameDay))
    return "the proposal must expire in the future";
  if (!Array.isArray(proposal.areaTransfers)) return "malformed area transfers";
  return validateTransfers(world, proposal);
}

/** Each listed area must belong to one side and go to the other, once. */
function validateTransfers(world: World, proposal: Omit<PeaceProposal, "id">): string | null {
  const seen = new Set<number>();
  const sides = [proposal.from, proposal.to];
  for (const transfer of proposal.areaTransfers) {
    if (!transfer || !isIndex(transfer.area, world.areas.length)) return "unknown area";
    if (seen.has(transfer.area)) return "an area is listed twice";
    seen.add(transfer.area);
    const owner = world.areas[transfer.area]?.owner;
    if (owner === null || owner === undefined || !sides.includes(owner)) return "an area belongs to neither side";
    if (!sides.includes(transfer.newOwner) || transfer.newOwner === owner) return "an area must go to the other side";
  }
  return null;
}

/** Phase 0: drops peace proposals past their expiry day. */
export function expireProposals(world: World): void {
  world.peaceProposals = world.peaceProposals.filter((proposal) => proposal.expiresAtDay >= world.gameDay);
}

// Application

const sameJob = (a: GovernmentJob, b: GovernmentJob): boolean => a.kind === b.kind && a.good === b.good;

function execute(world: World, government: Government, command: Command): void {
  switch (command.type) {
    case "setRealmPolicy":
      // The realm has nothing to fall back on, so a null value removes its setting.
      if (command.setting.value === null)
        government.realmPolicies = government.realmPolicies.filter(
          (s) => !(s.policy === command.setting.policy && s.good === command.setting.good),
        );
      else upsertSetting(government.realmPolicies, command.setting);
      for (const area of government.ownedAreas) resolvePolicies(government, area);
      return;
    case "setAreaPolicy":
      upsertSetting(stateOf(government, command.area).policyOverrides, command.setting);
      resolvePolicies(government, command.area);
      return;
    case "clearAreaPolicy": {
      const state = stateOf(government, command.area);
      state.policyOverrides = state.policyOverrides.filter(
        (s) => !(s.policy === command.policy && s.good === command.good),
      );
      resolvePolicies(government, command.area);
      return;
    }
    case "placeMarketOrder": {
      const { order } = command;
      government.marketOrders.push({
        id: world.nextOrderId++,
        area: order.area,
        good: order.good,
        side: order.side,
        remainingQuantity: order.remainingQuantity,
        limitPrice: order.limitPrice,
        maximumQuantityPerDay: order.maximumQuantityPerDay,
      });
      return;
    }
    case "cancelMarketOrder":
      government.marketOrders = government.marketOrders.filter((order) => order.id !== command.orderId);
      return;
    case "setJobTarget": {
      const state = stateOf(government, command.area);
      const assignment = state.jobs.find((job) => sameJob(job.job, command.job));
      if (assignment) assignment.targetWorkers = command.targetWorkers;
      else if (command.targetWorkers > 0)
        state.jobs.push({ job: { ...command.job }, targetWorkers: command.targetWorkers, workers: 0 });
      return;
    }
    case "setWageOffer":
      stateOf(government, command.area).wageOffer = command.wageOffer;
      return;
    case "setInfrastructureTarget": {
      // Building up waits for construction; taking down is at once, and also stops any construction.
      const area = world.areas[command.area] as Area;
      const state = stateOf(government, command.area);
      state.targetLevel[kindIndex(command.kind)] = command.level;
      if (command.level <= levelOf(area, command.kind))
        lowerInfrastructure(world, area, state, command.kind, command.level);
      return;
    }
    case "addStandingOrder": {
      const { order } = command;
      government.standingOrders.push({
        id: world.nextOrderId++,
        areas: order.areas === "all" ? "all" : [...order.areas],
        rule: { ...order.rule },
      });
      return;
    }
    case "removeStandingOrder":
      government.standingOrders = government.standingOrders.filter((order) => order.id !== command.orderId);
      return;
    case "recruitArmy": {
      const area = world.areas[command.area] as Area;
      const soldiers = takeWorkers(world, area, command.soldiers);
      area.population -= soldiers;
      const id = world.nextArmyId++;
      world.armies.set(id, {
        id,
        owner: government.id,
        location: { kind: "area", area: area.id },
        path: [],
        soldiers,
        weapons: 0,
        stance: "hold",
      });
      return;
    }
    case "disbandArmy": {
      const army = world.armies.get(command.army) as Army;
      returnSoldiers(world, army, command.soldiers);
      if (army.soldiers <= EPSILON) disbandArmy(world, army);
      return;
    }
    case "moveArmy": {
      const army = world.armies.get(command.army) as Army;
      const path = armyPath(world, government.id, planningOrigin(world, army), command.destination) as Path;
      army.path = path.steps.map((step) => step.to);
      return;
    }
    case "setArmyStance":
      (world.armies.get(command.army) as Army).stance = command.stance;
      return;
    case "setSoldierWage":
      government.soldierWage = command.wage;
      return;
    case "declareWar":
      setRelation(world, government.id, command.target, "war");
      return;
    case "proposePeace": {
      const { proposal } = command;
      world.peaceProposals.push({
        id: world.nextOrderId++,
        from: proposal.from,
        to: proposal.to,
        areaTransfers: proposal.areaTransfers.map((t) => ({ area: t.area, newOwner: t.newOwner })),
        payment: proposal.payment,
        expiresAtDay: proposal.expiresAtDay,
      });
      return;
    }
    case "answerPeace": {
      const proposal = world.peaceProposals.find((p) => p.id === command.proposalId) as PeaceProposal;
      world.peaceProposals = world.peaceProposals.filter((p) => p !== proposal);
      if (command.accept) makePeace(world, proposal);
      return;
    }
    default:
      throw new Error(`Command ${(command as Command).type} passed validation but has no effect`);
  }
}

function stateOf(government: Government, area: AreaId): GovernmentAreaState {
  return government.areaStates.get(area) as GovernmentAreaState;
}

function setRelation(world: World, a: number, b: number, relation: "peace" | "war"): void {
  (world.relations[a] as ("peace" | "war")[])[b] = relation;
  (world.relations[b] as ("peace" | "war")[])[a] = relation;
}

/** An accepted proposal: peace, the listed areas change hands as in a capture, and the payment moves. */
function makePeace(world: World, proposal: PeaceProposal): void {
  setRelation(world, proposal.from, proposal.to, "peace");
  for (const transfer of proposal.areaTransfers) {
    transferArea(world, world.areas[transfer.area] as Area, transfer.newOwner, false);
  }
  settleRealm(world, world.governments[proposal.from] as Government);
  settleRealm(world, world.governments[proposal.to] as Government);
  (world.governments[proposal.from] as Government).treasury -= proposal.payment;
  (world.governments[proposal.to] as Government).treasury += proposal.payment;
  const between = (p: PeaceProposal) =>
    (p.from === proposal.from && p.to === proposal.to) || (p.from === proposal.to && p.to === proposal.from);
  world.peaceProposals = world.peaceProposals.filter((p) => !between(p));
}
