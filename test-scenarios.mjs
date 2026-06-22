/**
 * Scenario tests for the ventilation evaluation engine.
 * Run: node test-scenarios.mjs
 */

import vm from 'node:vm';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(join(__dirname, 'app.mjs'), 'utf8');

const engineSource = appSource
  .replace(/^const elements =[\s\S]*?^function describeNeeds/m, 'function describeNeeds')
  .replace(/^elements\.unitInputs\.forEach[\s\S]*/m, '');

const sandbox = {
  document: {
    querySelector: () => ({ value: 'f' }),
    querySelectorAll: () => [],
    getElementById: () => null,
  },
};

vm.createContext(sandbox);
vm.runInContext(engineSource, sandbox);

const { evaluateConditions } = sandbox;

const scenarios = [
  {
    name: 'Classic evening cool-down',
    input: {
      indoorTempF: 78,
      outdoorTempF: 68,
      indoorRh: 55,
      outdoorRh: 45,
      weather: 'clear',
      unit: 'f',
    },
    expectVerdict: ['strong-good', 'good'],
  },
  {
    name: 'Comfortable home with cold outdoor air',
    input: {
      indoorTempF: 70,
      outdoorTempF: 45,
      indoorRh: 50,
      outdoorRh: 50,
      weather: 'clear',
      unit: 'f',
    },
    expectVerdict: ['likely-worse', 'avoid', 'not-worth-it'],
  },
  {
    name: 'Hot humid inside, warmer but much drier outside',
    input: {
      indoorTempF: 78,
      outdoorTempF: 82,
      indoorRh: 62,
      outdoorRh: 35,
      weather: 'clear',
      unit: 'f',
    },
    expectVerdict: ['good', 'marginal'],
  },
  {
    name: 'Outdoor air is not cooler than inside',
    input: {
      indoorTempF: 74,
      outdoorTempF: 75,
      indoorRh: 52,
      outdoorRh: 50,
      weather: 'cloudy',
      unit: 'f',
    },
    expectVerdict: ['avoid', 'likely-worse', 'not-worth-it'],
  },
  {
    name: 'Rainy but outdoor air is drier — dehumidify',
    input: {
      indoorTempF: 72,
      outdoorTempF: 68,
      indoorRh: 65,
      outdoorRh: 40,
      weather: 'rainy',
      unit: 'f',
    },
    expectVerdict: ['good', 'strong-good', 'marginal'],
  },
  {
    name: 'Hotter outside — should avoid',
    input: {
      indoorTempF: 74,
      outdoorTempF: 88,
      indoorRh: 52,
      outdoorRh: 55,
      weather: 'clear',
      unit: 'f',
    },
    expectVerdict: ['avoid', 'likely-worse'],
  },
  {
    name: 'Winter condensation risk',
    input: {
      indoorTempF: 70,
      outdoorTempF: 35,
      indoorRh: 60,
      outdoorRh: 80,
      weather: 'cloudy',
      unit: 'f',
    },
    expectVerdict: ['avoid', 'likely-worse', 'not-worth-it'],
  },
  {
    name: 'Free cooling when already at setpoint',
    input: {
      indoorTempF: 72,
      outdoorTempF: 64,
      indoorRh: 50,
      outdoorRh: 45,
      weather: 'cloudy',
      unit: 'f',
    },
    expectNeeds: ['maintain'],
    expectVerdict: ['good', 'marginal'],
  },
  {
    name: 'Fall drying — comfortable temp, humid inside, cool dry outside',
    input: {
      indoorTempF: 70,
      outdoorTempF: 55,
      indoorRh: 62,
      outdoorRh: 45,
      weather: 'cloudy',
      unit: 'f',
    },
    expectVerdict: ['good', 'marginal', 'strong-good'],
  },
  {
    name: 'Strong cool outdoor air on cloudy day',
    input: {
      indoorTempF: 76,
      outdoorTempF: 65,
      indoorRh: 48,
      outdoorRh: 40,
      weather: 'cloudy',
      unit: 'f',
    },
    expectVerdict: ['strong-good', 'good'],
  },
  {
    name: 'Cooler preference — 72°F feels hot when max is 71°F',
    input: {
      indoorTempF: 72,
      outdoorTempF: 64,
      indoorRh: 50,
      outdoorRh: 45,
      weather: 'cloudy',
      unit: 'f',
      comfortMinF: 65,
      comfortMaxF: 71,
    },
    expectVerdict: ['strong-good', 'good'],
  },
  {
    name: 'In comfort band — cold outdoor air, modest realistic shift (67-73°F)',
    input: {
      indoorTempF: 72,
      outdoorTempF: 64,
      indoorRh: 50,
      outdoorRh: 45,
      weather: 'cloudy',
      unit: 'f',
      comfortMinF: 67,
      comfortMaxF: 73,
    },
    expectNeeds: ['maintain'],
    expectVerdict: ['good', 'marginal'],
  },
  {
    name: 'Above max — modest outdoor cooling on sunny day (70-74°F)',
    input: {
      indoorTempF: 75,
      outdoorTempF: 70,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'clear',
      unit: 'f',
      comfortMinF: 70,
      comfortMaxF: 74,
    },
    expectNeeds: ['cool'],
    expectVerdict: ['marginal', 'good'],
  },
  {
    name: 'Near band edge — 70°F outdoor OK with 71-77°F range (sunny)',
    input: {
      indoorTempF: 75,
      outdoorTempF: 70,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'clear',
      unit: 'f',
      comfortMinF: 71,
      comfortMaxF: 77,
    },
    expectNeeds: ['maintain'],
    expectVerdict: ['marginal', 'good', 'not-worth-it'],
  },
  {
    name: 'Near band edge — 70°F outdoor OK with 71-78°F range (sunny)',
    input: {
      indoorTempF: 75,
      outdoorTempF: 70,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'clear',
      unit: 'f',
      comfortMinF: 71,
      comfortMaxF: 78,
    },
    expectNeeds: ['maintain'],
    expectVerdict: ['marginal', 'good', 'not-worth-it'],
  },
  {
    name: 'Same conditions — cloudy scores better than sunny for modest cooling',
    input: {
      indoorTempF: 75,
      outdoorTempF: 70,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'cloudy',
      unit: 'f',
      comfortMinF: 71,
      comfortMaxF: 78,
    },
    expectNeeds: ['maintain'],
    expectVerdict: ['marginal', 'good'],
  },
  {
    name: 'Wide range — outdoor in band on sunny day (64-78°F)',
    input: {
      indoorTempF: 75,
      outdoorTempF: 70,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'clear',
      unit: 'f',
      comfortMinF: 64,
      comfortMaxF: 78,
    },
    expectNeeds: ['maintain'],
    expectVerdict: ['marginal', 'good', 'not-worth-it'],
  },
  {
    name: 'Comfortable in band — cool outdoor on sunny day (71-78°F)',
    input: {
      indoorTempF: 75,
      outdoorTempF: 70,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'clear',
      unit: 'f',
      comfortMinF: 71,
      comfortMaxF: 78,
    },
    expectNeeds: ['maintain'],
    expectVerdict: ['marginal', 'good'],
  },
  {
    name: 'Cold outdoor air — realistic shift stays in band (71-78°F)',
    input: {
      indoorTempF: 75,
      outdoorTempF: 65,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'clear',
      unit: 'f',
      comfortMinF: 71,
      comfortMaxF: 78,
    },
    expectNeeds: ['dehumidify', 'maintain'],
    expectVerdict: ['good', 'strong-good'],
  },
  {
    name: 'Rainy maintain — uses rain logic, not solar bonus',
    input: {
      indoorTempF: 72,
      outdoorTempF: 68,
      indoorRh: 50,
      outdoorRh: 50,
      weather: 'rainy',
      unit: 'f',
    },
    expectNeeds: ['maintain'],
    expectWeatherTitle: 'Rain usually means wetter air',
  },
  {
    name: 'Comfortable in band — cloudy day with modest outdoor cooling',
    input: {
      indoorTempF: 75,
      outdoorTempF: 70,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'cloudy',
      unit: 'f',
      comfortMinF: 71,
      comfortMaxF: 78,
    },
    expectNeeds: ['maintain'],
    expectVerdict: ['marginal', 'good'],
  },
  {
    name: 'Windy maintain — uses wind factor, not solar',
    input: {
      indoorTempF: 75,
      outdoorTempF: 70,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'windy',
      unit: 'f',
      comfortMinF: 71,
      comfortMaxF: 78,
    },
    expectNeeds: ['maintain'],
    expectWeatherTitle: 'Breeze helps air exchange',
  },
  {
    name: 'Just below band minimum — short airing OK (74-78°F)',
    input: {
      indoorTempF: 75,
      outdoorTempF: 70,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'clear',
      unit: 'f',
      comfortMinF: 74,
      comfortMaxF: 78,
    },
    expectNeeds: ['maintain'],
    expectVerdict: ['marginal', 'good', 'not-worth-it'],
  },
  {
    name: 'Clear summer night — no solar heating penalty',
    input: {
      indoorTempF: 75,
      outdoorTempF: 70,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'clear',
      unit: 'f',
      comfortMinF: 71,
      comfortMaxF: 78,
      latitudeDeg: 40,
      localDate: '2025-06-21',
      localTimeMinutes: 22 * 60,
    },
    expectNeeds: ['maintain'],
    expectWeatherTitle: 'Dark outside — no solar heating',
    expectVerdict: ['marginal', 'good'],
  },
  {
    name: 'Clear summer midday — comfortable in band, cool outdoor air',
    input: {
      indoorTempF: 75,
      outdoorTempF: 70,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'clear',
      unit: 'f',
      comfortMinF: 71,
      comfortMaxF: 78,
      latitudeDeg: 40,
      localDate: '2025-06-21',
      localTimeMinutes: 14 * 60,
    },
    expectNeeds: ['maintain'],
    expectWeatherTitle: 'Cool outdoor air helps freshness',
    expectVerdict: ['marginal', 'good'],
  },
  {
    name: 'Clear summer afternoon — much cooler outdoor, stays in band',
    input: {
      indoorTempF: 75,
      outdoorTempF: 64,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'clear',
      unit: 'f',
      comfortMinF: 70,
      comfortMaxF: 78,
      latitudeDeg: 41,
      localDate: '2026-06-22',
      localTimeMinutes: 15 * 60 + 13,
    },
    expectNeeds: ['dehumidify', 'maintain'],
    expectWeatherTitle: 'Cool outdoor air — good time to freshen up',
    expectVerdict: ['good', 'strong-good'],
  },
  {
    name: 'Windy afternoon — much cooler outdoor, stays in band',
    input: {
      indoorTempF: 75,
      outdoorTempF: 64,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'windy',
      unit: 'f',
      comfortMinF: 70,
      comfortMaxF: 78,
      latitudeDeg: 41,
      localDate: '2026-06-22',
      localTimeMinutes: 15 * 60 + 13,
    },
    expectNeeds: ['dehumidify', 'maintain'],
    expectWeatherTitle: 'Breeze improves air exchange',
    expectVerdict: ['good', 'strong-good'],
  },
  {
    name: 'Cloudy summer night — no spurious overcast solar bonus',
    input: {
      indoorTempF: 75,
      outdoorTempF: 70,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'cloudy',
      unit: 'f',
      comfortMinF: 71,
      comfortMaxF: 78,
      latitudeDeg: 40,
      localDate: '2025-06-21',
      localTimeMinutes: 23 * 60,
    },
    expectNeeds: ['dehumidify', 'maintain'],
    expectWeatherTitle: 'Dark outside — no solar heating',
    expectVerdict: ['marginal', 'good'],
  },
  {
    name: 'In band at 52% RH — dryness goal even when temp is OK',
    input: {
      indoorTempF: 72,
      outdoorTempF: 68,
      indoorRh: 52,
      outdoorRh: 55,
      weather: 'cloudy',
      unit: 'f',
      comfortMinF: 67,
      comfortMaxF: 75,
    },
    expectNeeds: ['dehumidify', 'maintain'],
    expectVerdict: ['marginal', 'good', 'not-worth-it'],
  },
];

let failed = 0;

for (const scenario of scenarios) {
  const result = evaluateConditions(scenario.input);
  const ok = !scenario.expectVerdict || scenario.expectVerdict.includes(result.verdict.level);
  const needsOk = !scenario.expectNeeds || scenario.expectNeeds.every((n) => result.needs.includes(n));
  const weatherTitleOk =
    !scenario.expectWeatherTitle || result.weatherFactor.title === scenario.expectWeatherTitle;
  if (!ok || !needsOk || !weatherTitleOk) failed += 1;
  console.log(
    `${ok && needsOk && weatherTitleOk ? 'PASS' : 'FAIL'} ${scenario.name}`,
    `\n  verdict: ${result.verdict.level} (${result.verdict.badge}), score: ${result.totalScore}`,
    `\n  needs: ${result.needs.join(', ')}`,
  );
  if (!ok) {
    console.log(`  expected verdict one of: ${scenario.expectVerdict.join(', ')}`);
    console.log(
      `  factors: temp=${result.tempFactor.score}, humidity=${result.humidityFactor.score}, cond=${result.condensationFactor.score}, weather=${result.weatherFactor.score}`,
    );
  }
  if (!needsOk) {
    console.log(`  expected needs to include: ${scenario.expectNeeds.join(', ')}`);
  }
  if (!weatherTitleOk) {
    console.log(`  expected weather title: ${scenario.expectWeatherTitle}`);
    console.log(`  got weather title: ${result.weatherFactor.title}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} scenario(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${scenarios.length} scenarios passed.`);
