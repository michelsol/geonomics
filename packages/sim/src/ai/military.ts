// An AI's wars (specification §10): defense for every personality; conquest, armies and weapons for the conqueror;
// peace when a war has run its course.
import { runningLevel } from "../snapshot";
import { chord } from "../sphere";
import type { AiMemory, AiWar, AreaId, Army, Command, GovernmentId } from "../types";
import type { Traits } from "./personalities";
import { armyArea, armyPower, canReach, defenseOf, ownerOf, type Realm, recruitable } from "./realm";
import type { AiView } from "./view";

const PROPOSAL_DAYS = 30; // a peace proposal expires after this long, and the next one waits as long
const DEFENDER_PEACE_DAYS = 30; // an attacked realm asks for peace after this long
const RECENT_CAPTURE_DAYS = 60; // an attacker that captured lately is not weary yet
const AREA_RECRUIT_SHARE = 0.1; // a defending army raised in an area takes at most this share of its population
const ARMY_RECRUIT_SHARE = 0.01; // the standing army takes at most this share of an area's population per decision
const RECRUITING_AREAS = 3; // the standing army is raised in this many of the most populous areas
const MARCHING_ARMIES = 8; // armies sent to attack in one decision at most, the largest first: each order plans a path
const MINIMUM_RECRUITS = 50;
const MINIMUM_ATTACK_ARMY = 200;
const ATTACK_ODDS = 1.5; // attack an area only with this much more power than its defense
const WAR_ODDS = 2; // declare war only with this much more power than the target's weakest border area
const LARGEST_TARGET_POPULATION = 3; // never attack a realm more populous than this many times its own

export function decideMilitary(
  view: AiView,
  realm: Realm,
  memory: AiMemory,
  traits: Traits,
  commands: Command[],
  random: () => number,
): void {
  syncWars(view, realm, memory);
  const accepted = answerProposals(view, realm, memory, traits, commands);
  defend(view, realm, memory, commands);
  if (traits.aggressive) {
    raiseArmy(view, realm, traits, commands);
    if (memory.wars.some((war) => war.declaredByMe)) attack(view, realm, memory, traits, commands);
    else considerWar(view, realm, memory, traits, commands, random);
  }
  proposePeace(view, realm, memory, traits, commands, accepted);
  if (memory.wars.length === 0) standDown(view, realm, traits, commands);
}

/** Notices wars that began or ended since the last decision, and captures. */
function syncWars(view: AiView, realm: Realm, memory: AiMemory): void {
  const relations = view.snapshot.relations[view.me] ?? [];
  const before = memory.wars.length;
  memory.wars = memory.wars.filter((war) => relations[war.enemy] === "war");
  if (memory.wars.length < before) memory.lastPeaceDay = realm.day;
  relations.forEach((relation, enemy) => {
    if (relation === "war" && !memory.wars.some((war) => war.enemy === enemy))
      memory.wars.push(newWar(view, enemy, realm, false));
  });
  if (realm.owned.size > memory.ownedAreaCount) for (const war of memory.wars) war.lastCaptureDay = realm.day;
}

function newWar(view: AiView, enemy: GovernmentId, realm: Realm, declaredByMe: boolean): AiWar {
  return {
    enemy,
    startDay: realm.day,
    areasAtStart: realm.owned.size,
    enemyAreasAtStart: view.snapshot.governments[enemy]?.areaCount ?? 0,
    lastCaptureDay: realm.day,
    declaredByMe,
    lastProposalDay: null,
    target: null,
  };
}

const powerOf = (view: AiView, owner: GovernmentId) =>
  view.snapshot.armies.reduce((sum, army) => sum + (army.owner === owner ? armyPower(army) : 0), 0);

function losing(view: AiView, realm: Realm, war: AiWar): boolean {
  return realm.owned.size < war.areasAtStart && powerOf(view, war.enemy) >= powerOf(view, view.me);
}

/**
 * An attacker is done once it took its share of the enemy's areas, or the war has lasted long enough without a recent
 * capture, or too long anyway; a defender only wants peace.
 */
function wantsPeace(view: AiView, realm: Realm, war: AiWar, traits: Traits): boolean {
  if (!war.declaredByMe || !traits.aggressive) return true;
  const days = realm.day - war.startDay;
  const weary = days >= traits.warWearinessDays && realm.day - war.lastCaptureDay >= RECENT_CAPTURE_DAYS;
  const conquered = realm.owned.size - war.areasAtStart >= Math.max(1, traits.conquestShare * war.enemyAreasAtStart);
  return (
    weary ||
    conquered ||
    days >= traits.maximumWarDays ||
    losing(view, realm, war) ||
    realm.government.treasury < realm.reserve / 3
  );
}

/** Answers the peace proposals made to this realm; returns the governments it makes peace with. */
function answerProposals(
  view: AiView,
  realm: Realm,
  memory: AiMemory,
  traits: Traits,
  commands: Command[],
): Set<GovernmentId> {
  const accepted = new Set<GovernmentId>();
  for (const proposal of view.snapshot.peaceProposals) {
    if (proposal.to !== view.me) continue;
    const war = memory.wars.find((w) => w.enemy === proposal.from);
    const lost = proposal.areaTransfers.filter((t) => t.newOwner !== view.me && realm.owned.has(t.area)).length;
    const cost = Math.max(0, -proposal.payment);
    const treasury = realm.government.treasury;
    const wants = !war || wantsPeace(view, realm, war, traits);
    const beaten = war !== undefined && losing(view, realm, war);
    const accept = (wants && lost === 0 && cost <= 0.1 * treasury) || (beaten && lost <= 2 && cost <= 0.2 * treasury);
    commands.push({ type: "answerPeace", proposalId: proposal.id, accept });
    if (accept) accepted.add(proposal.from);
  }
  return accepted;
}

function proposePeace(
  view: AiView,
  realm: Realm,
  memory: AiMemory,
  traits: Traits,
  commands: Command[],
  accepted: ReadonlySet<GovernmentId>,
): void {
  for (const war of memory.wars) {
    if (accepted.has(war.enemy)) continue; // peace is made already
    if (war.lastProposalDay !== null && realm.day - war.lastProposalDay < PROPOSAL_DAYS) continue;
    const pending = view.snapshot.peaceProposals.some((p) => p.from === view.me && p.to === war.enemy);
    if (pending) continue;
    const ready = war.declaredByMe
      ? wantsPeace(view, realm, war, traits)
      : realm.day - war.startDay >= DEFENDER_PEACE_DAYS;
    if (!ready) continue;
    war.lastProposalDay = realm.day;
    commands.push({
      type: "proposePeace",
      proposal: {
        from: view.me,
        to: war.enemy,
        areaTransfers: [],
        payment: 0,
        expiresAtDay: realm.day + PROPOSAL_DAYS,
      },
    });
  }
}

const idle = (army: Army) => army.location.kind === "area" && army.path.length === 0;

/** Idle armies at home, the largest first, as many as one decision sends. */
const readyArmies = (view: AiView, realm: Realm) =>
  realm.armies
    .filter((army) => idle(army) && realm.owned.has(armyArea(view, army)))
    .sort((a, b) => b.soldiers - a.soldiers)
    .slice(0, MARCHING_ARMIES);

/** Raises holding armies where enemy attackers stand or march, and sends idle armies there. */
function defend(view: AiView, realm: Realm, memory: AiMemory, commands: Command[]): void {
  if (memory.wars.length === 0) return;
  const enemies = new Set(memory.wars.map((war) => war.enemy));
  const threat = new Map<AreaId, number>();
  for (const army of view.snapshot.armies) {
    if (!enemies.has(army.owner)) continue;
    const area = [armyArea(view, army), ...army.path.slice(0, 1)].find((a) => realm.owned.has(a));
    if (area !== undefined) threat.set(area, (threat.get(area) ?? 0) + armyPower(army));
  }
  const { areas } = view.snapshot;
  const sent = new Set<number>();
  for (const [area, power] of [...threat].sort((a, b) => b[1] - a[1])) {
    const fortification = 1 + runningLevel(areas, area, "fort");
    const defense = defenseOf(view, area);
    if (power <= 0.8 * defense) continue;
    const wanted = Math.ceil((1.2 * power - defense) / fortification);
    const soldiers = Math.floor(
      Math.min(wanted, recruitable(view, area), AREA_RECRUIT_SHARE * (areas.population[area] as number)),
    );
    if (soldiers >= MINIMUM_RECRUITS) commands.push({ type: "recruitArmy", area, soldiers });
    // The nearest idle army at home joins in.
    const helper = realm.armies
      .filter(
        (army) =>
          idle(army) &&
          !sent.has(army.id) &&
          !threat.has(armyArea(view, army)) &&
          canReach(view, armyArea(view, army), area),
      )
      .sort((a, b) => distance(view, armyArea(view, a), area) - distance(view, armyArea(view, b), area))[0];
    if (helper) {
      sent.add(helper.id);
      commands.push({ type: "moveArmy", army: helper.id, destination: area });
    }
  }
}

function distance(view: AiView, a: AreaId, b: AreaId): number {
  const p = view.data.areas[a];
  const q = view.data.areas[b];
  return p && q ? chord(p, q) : Number.POSITIVE_INFINITY;
}

/**
 * Keeps the conqueror's standing army at its share of the population. Soldiers come from the most populous areas, a
 * little from each, so no area is drained.
 */
function raiseArmy(view: AiView, realm: Realm, traits: Traits, commands: Command[]): void {
  if (realm.government.treasury < realm.reserve) return;
  const missing = traits.armyShare * realm.population - realm.soldiers;
  if (missing < MINIMUM_RECRUITS) return;
  const { population } = view.snapshot.areas;
  const sources = [...realm.owned]
    .sort((a, b) => (population[b] as number) - (population[a] as number))
    .slice(0, RECRUITING_AREAS);
  for (const area of sources) {
    const soldiers = Math.floor(
      Math.min(missing / sources.length, recruitable(view, area), ARMY_RECRUIT_SHARE * (population[area] as number)),
    );
    if (soldiers >= MINIMUM_RECRUITS) commands.push({ type: "recruitArmy", area, soldiers });
  }
}

/** Enemy areas across a land border, weakest first, among the governments it attacks: armies reach them by land. */
function frontline(
  view: AiView,
  realm: Realm,
  enemies: ReadonlySet<GovernmentId>,
): { area: AreaId; defense: number }[] {
  const seen = new Set<AreaId>();
  const areas: { area: AreaId; defense: number }[] = [];
  for (const own of realm.owned)
    for (const other of view.landNeighbors[own] ?? []) {
      const owner = ownerOf(view, other);
      if (owner === null || !enemies.has(owner) || seen.has(other)) continue;
      seen.add(other);
      areas.push({ area: other, defense: defenseOf(view, other) });
    }
  return areas.sort((a, b) => a.defense - b.defense);
}

/** Armies at home march together on the weakest enemy area next to the realm. */
function attack(view: AiView, realm: Realm, memory: AiMemory, traits: Traits, commands: Command[]): void {
  // A war that has run its course waits for peace: no new attacks.
  const wars = memory.wars.filter((war) => war.declaredByMe && !wantsPeace(view, realm, war, traits));
  const enemies = new Set(wars.map((war) => war.enemy));
  // Armies fighting in enemy land keep at it; those at home and idle go to the front.
  const ready = readyArmies(view, realm);
  const power = ready.reduce((sum, army) => sum + armyPower(army), 0);
  if (ready.length === 0 || power < MINIMUM_ATTACK_ARMY) return;
  const target = frontline(view, realm, enemies).find((entry) => power >= ATTACK_ODDS * entry.defense);
  if (!target) return;
  for (const war of wars) if (war.enemy === ownerOf(view, target.area)) war.target = target.area;
  for (const army of ready) {
    if (!canReach(view, armyArea(view, army), target.area)) continue;
    commands.push({ type: "moveArmy", army: army.id, destination: target.area });
  }
}

/** At peace and ready, a conqueror declares war on the neighbor whose border is weakest against its army. */
function considerWar(
  view: AiView,
  realm: Realm,
  memory: AiMemory,
  traits: Traits,
  commands: Command[],
  random: () => number,
): void {
  if (memory.wars.length > 0) return;
  if (realm.day - memory.createdDay < traits.firstWarDelayDays) return;
  if (memory.lastPeaceDay !== null && realm.day - memory.lastPeaceDay < traits.peaceCooldownDays) return;
  // Ready once the army is near its target, or as near as recruiting gets it.
  const target = traits.armyShare * realm.population;
  if (realm.soldiers < Math.min(0.8 * target, target - MINIMUM_RECRUITS) || realm.government.treasury < realm.reserve)
    return;
  const ready = readyArmies(view, realm);
  const power = ready.reduce((sum, army) => sum + armyPower(army), 0);
  const summaries = view.snapshot.governments;
  const neighbors = new Set<GovernmentId>();
  for (const own of realm.owned)
    for (const other of view.landNeighbors[own] ?? []) {
      const owner = ownerOf(view, other);
      if (owner !== null && owner !== view.me && !summaries[owner]?.isEliminated) neighbors.add(owner);
    }
  const options = [...neighbors]
    .filter((g) => (summaries[g]?.population ?? 0) <= LARGEST_TARGET_POPULATION * realm.population)
    .map((g) => ({ enemy: g, weakest: frontline(view, realm, new Set([g]))[0] }))
    .filter((option) => option.weakest !== undefined && power >= WAR_ODDS * option.weakest.defense)
    .map((option) => ({ ...option, score: (option.weakest?.defense ?? 0) * (1 + 0.2 * random()) }))
    .sort((a, b) => a.score - b.score);
  const choice = options[0];
  if (!choice?.weakest) return;
  commands.push({ type: "declareWar", target: choice.enemy });
  const war = newWar(view, choice.enemy, realm, true);
  war.target = choice.weakest.area;
  memory.wars.push(war);
  for (const army of ready) {
    if (canReach(view, armyArea(view, army), choice.weakest.area))
      commands.push({ type: "moveArmy", army: army.id, destination: choice.weakest.area });
  }
}

/** At peace: armies abroad come home, and soldiers beyond the personality's army go back to work. */
function standDown(view: AiView, realm: Realm, traits: Traits, commands: Command[]): void {
  const capital = realm.government.capital;
  for (const army of realm.armies) {
    if (!idle(army)) continue;
    if (!realm.owned.has(armyArea(view, army)) && capital !== null && canReach(view, armyArea(view, army), capital))
      commands.push({ type: "moveArmy", army: army.id, destination: capital });
  }
  let excess = realm.soldiers - 1.5 * traits.armyShare * realm.population;
  const home = realm.armies
    .filter((army) => idle(army) && realm.owned.has(armyArea(view, army)))
    .sort((a, b) => b.soldiers - a.soldiers);
  for (const army of home) {
    if (excess < MINIMUM_RECRUITS) break;
    const soldiers = Math.min(army.soldiers, Math.floor(excess));
    commands.push({ type: "disbandArmy", army: army.id, soldiers });
    excess -= soldiers;
  }
}
