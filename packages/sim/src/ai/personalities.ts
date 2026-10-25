// The three AI personalities (specification §11): the same rules, tuned differently.
import type { InfrastructureKind, Personality } from "../types";

export interface Traits {
  baseTax: number; // realm production tax rate at the first decision
  minimumTax: number; // the tax never goes below this
  maximumTax: number; // nor above this
  reserveDays: number; // days of tax income the treasury should hold
  infrastructureShare: number; // share of tax income, after soldiers' wages, spent on infrastructure staff and building
  infrastructureWeights: Record<InfrastructureKind, number>; // how much each kind matters next to the others
  maximumPorts: number; // areas with a port the realm builds up to
  maximumAirports: number; // areas with an airport the realm builds up to
  armyShare: number; // standing army as a share of the realm's population
  aggressive: boolean; // declares wars of conquest
  firstWarDelayDays: number; // days after its first decision before a first war
  peaceCooldownDays: number; // days after a peace before the next war
  warWearinessDays: number; // an attacker accepts or proposes peace after this long without a recent capture
  maximumWarDays: number; // and after this long in any case
  conquestShare: number; // and once it took this share of the enemy's areas
}

const PEACEFUL = {
  aggressive: false,
  firstWarDelayDays: 0,
  peaceCooldownDays: 0,
  warWearinessDays: 0,
  maximumWarDays: 0,
  conquestShare: 0,
};

export const TRAITS: Record<Exclude<Personality, "idle">, Traits> = {
  trader: {
    baseTax: 0.04,
    minimumTax: 0.02,
    maximumTax: 0.2,
    reserveDays: 60,
    infrastructureShare: 0.4,
    infrastructureWeights: { port: 0.35, airport: 0.2, roads: 0.4, fort: 0.05 },
    maximumPorts: 4,
    maximumAirports: 2,
    armyShare: 0.005,
    ...PEACEFUL,
  },
  builder: {
    baseTax: 0.06,
    minimumTax: 0.03,
    maximumTax: 0.25,
    reserveDays: 60,
    infrastructureShare: 0.6,
    infrastructureWeights: { port: 0.15, airport: 0.15, roads: 0.45, fort: 0.25 },
    maximumPorts: 3,
    maximumAirports: 2,
    armyShare: 0.01,
    ...PEACEFUL,
  },
  conqueror: {
    baseTax: 0.08,
    minimumTax: 0.05,
    maximumTax: 0.3,
    reserveDays: 45,
    infrastructureShare: 0.25,
    infrastructureWeights: { port: 0.05, airport: 0.05, roads: 0.3, fort: 0.6 },
    maximumPorts: 2,
    maximumAirports: 1,
    armyShare: 0.015,
    aggressive: true,
    firstWarDelayDays: 90,
    peaceCooldownDays: 120,
    warWearinessDays: 150,
    maximumWarDays: 360,
    conquestShare: 0.2,
  },
};
