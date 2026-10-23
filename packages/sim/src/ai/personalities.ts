// The three AI personalities (specification §11): the same rules, tuned differently.
import type { Personality } from "../types";

export interface Traits {
  baseTax: number; // realm production tax rate at the first decision
  minimumTax: number; // the tax never goes below this
  maximumTax: number; // nor above this
  reserveDays: number; // days of tax income the treasury should hold
  jobShare: number; // share of tax income, after soldiers' wages, spent on government jobs
  jobWeights: { research: number; infrastructure: number; ports: number; fortify: number };
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
    jobShare: 0.4,
    jobWeights: { research: 0.1, infrastructure: 0.45, ports: 0.4, fortify: 0.05 },
    armyShare: 0.005,
    ...PEACEFUL,
  },
  builder: {
    baseTax: 0.06,
    minimumTax: 0.03,
    maximumTax: 0.25,
    reserveDays: 60,
    jobShare: 0.6,
    jobWeights: { research: 0.35, infrastructure: 0.35, ports: 0.1, fortify: 0.2 },
    armyShare: 0.01,
    ...PEACEFUL,
  },
  conqueror: {
    baseTax: 0.08,
    minimumTax: 0.05,
    maximumTax: 0.3,
    reserveDays: 45,
    jobShare: 0.25,
    jobWeights: { research: 0.2, infrastructure: 0.2, ports: 0.05, fortify: 0.55 },
    armyShare: 0.015,
    aggressive: true,
    firstWarDelayDays: 90,
    peaceCooldownDays: 120,
    warWearinessDays: 150,
    maximumWarDays: 360,
    conquestShare: 0.2,
  },
};
