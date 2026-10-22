// Phase 0: command validation and application (specification §3, Commands and Command validation).
import { resolvePolicies, upsertSetting } from "./government";
import { type Path, shortestPath } from "./graph";
import type {
  Area,
  AreaId,
  Command,
  CommandEnvelope,
  Edge,
  Government,
  GovernmentAreaState,
  GovernmentJob,
  PolicyName,
  PolicySetting,
  StandingRule,
  World,
} from "./types";

/** Player id under which AI governments send their commands; the host never accepts it from the network. */
export const AI_PLAYER = "ai";
export const MAXIMUM_MARKET_ORDERS = 1000;
export const MAXIMUM_STANDING_ORDERS = 200;
const MINIMUM_TAX_RATE = -1;
const MAXIMUM_TAX_RATE = 5;
const MAXIMUM_WAGE_OFFER = 10;

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
    case "transferGoods":
      return validateTransfer(world, government, command);
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
    case "recruitArmy":
    case "disbandArmy":
    case "moveArmy":
    case "setArmyStance":
    case "supplyArmy":
    case "declareWar":
    case "proposePeace":
    case "answerPeace":
      return "not available yet";
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
    if (value !== null && !isAmount(value)) return "head tax must be finite and non-negative";
    return null;
  }
  if (!PER_GOOD_POLICIES.includes(policy)) return "unknown policy";
  if (!isIndex(good, world.goods.length)) return "unknown good";
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
  switch (job.kind) {
    case "produce": {
      if (!isIndex(job.good, world.goods.length)) return "unknown good";
      const good = world.goods[job.good] as World["goods"][number];
      if (good.isService) return "a government cannot produce a service";
      if (good.isPrimary && (area.naturalCapacityMaximum[good.id] as number) <= 0)
        return "the area has no natural capacity for this good";
      return null;
    }
    case "buildInfrastructure": {
      if (!isIndex(job.edge, world.edges.length)) return "unknown edge";
      const edge = world.edges[job.edge] as Edge;
      if (edge.areaA !== area.id && edge.areaB !== area.id) return "the edge does not touch the area";
      if (edge.mode !== "land") return "infrastructure is built on land edges only";
      return null;
    }
    case "buildPort":
      return area.isCoastal ? null : "ports can only be built in coastal areas";
    case "fortify":
    case "buildAirport":
    case "research":
      return null;
    default:
      return "unknown job";
  }
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
    case "supplyArmies":
      return "not available yet";
    default:
      return "unknown rule";
  }
}

function validateTransfer(
  world: World,
  government: Government,
  command: Extract<Command, { type: "transferGoods" }>,
): string | null {
  const source = ownedState(world, government, command.from);
  if (!source.state) return source.reason;
  const destination = ownedState(world, government, command.to);
  if (!destination.state) return destination.reason;
  if (command.from === command.to) return "source and destination are the same area";
  const reason = validateGood(world, command.good);
  if (reason) return reason;
  if (!isAmount(command.quantity)) return "quantity must be finite and non-negative";
  if (command.quantity > (source.state.depot[command.good] as number)) return "not enough goods in the depot";
  const path = transferPath(world, command.from, command.to);
  if (!path) return "no open path between the two depots";
  if (transferCost(world, path, command.good, command.quantity) > government.treasury)
    return "the treasury cannot pay the transport";
  return null;
}

// Depot transfers (specification §6, Depots and transfers)

/** Cheapest path by transport cost through active, non-blocked edges of every mode. */
export function transferPath(world: World, from: AreaId, to: AreaId): Path | null {
  return shortestPath(world, from, to, (edge) => (edge.isActive && !edge.isBlocked ? edge.transportCost : null));
}

export function transferCost(world: World, path: Path, good: number, quantity: number): number {
  return path.cost * (world.goods[good]?.transportWeight ?? 0) * quantity;
}

/** Game days goods take along a path: each edge's travel days, and airFreightDays on air routes. */
export function transferDays(world: World, path: Path): number {
  let days = 0;
  for (const step of path.steps) {
    const edge = world.edges[step.edge] as Edge;
    days += edge.mode === "air" ? world.config.transport.airFreightDays : edge.travelDays;
  }
  return days;
}

// Application

const sameJob = (a: GovernmentJob, b: GovernmentJob): boolean =>
  a.kind === b.kind &&
  (a.kind !== "produce" || a.good === (b as typeof a).good) &&
  (a.kind !== "buildInfrastructure" || a.edge === (b as typeof a).edge);

function execute(world: World, government: Government, command: Command): void {
  switch (command.type) {
    case "setRealmPolicy":
      upsertSetting(government.realmPolicies, command.setting);
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
    case "transferGoods": {
      const path = transferPath(world, command.from, command.to) as Path;
      const source = stateOf(government, command.from);
      source.depot[command.good] = (source.depot[command.good] as number) - command.quantity;
      // Transport is paid to the carriers of the source area, as in private trade.
      const cost = transferCost(world, path, command.good, command.quantity);
      government.treasury -= cost;
      (world.areas[command.from] as Area).savings += cost;
      government.depotTransfers.push({
        good: command.good,
        quantity: command.quantity,
        destination: command.to,
        daysRemaining: transferDays(world, path),
      });
      return;
    }
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
    default:
      throw new Error(`Command ${command.type} passed validation but has no effect`);
  }
}

function stateOf(government: Government, area: AreaId): GovernmentAreaState {
  return government.areaStates.get(area) as GovernmentAreaState;
}
