import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMFORT,
  COMFORT_DEFAULT_MAX_F,
  COMFORT_DEFAULT_MIN_F,
  COMFORT_MIN_SPAN_F,
  INTERNAL_GAIN_SHIFT_F,
  VENTILATION_MAX_SHIFT_F,
  VERDICTS,
  absoluteHumidityGpm3,
  buildHeadline,
  buildSummary,
  comfortBoundsFromLegacyTarget,
  describeSunlightWindow,
  dewPointFahrenheit,
  estimateVentilationTempShiftF,
  estimateInternalGainShiftF,
  estimateSolarHeatingShiftF,
  evaluateConditions,
  formatComfortRange,
  formatDelta,
  formatDewPointDifference,
  formatSolarHeatingMetric,
  formatTemp,
  formatTempDifference,
  formatVentilationShift,
  fromFahrenheit,
  getSolarIntensityFactor,
  getSunriseSunsetLocalMinutes,
  inferIndoorNeeds,
  isMuchDrierOutdoor,
  isNullish,
  normalizeComfortBounds,
  normalizeLocalDate,
  pickVerdict,
  resolveSolarIntensity,
  scoreCondensationRisk,
  scoreHumidity,
  scoreTemperature,
  scoreWeather,
  toFahrenheit,
  ventilationShiftIsCapped,
  weatherSolarMultiplier,
} from './engine.mjs';

describe('comfort bounds', () => {
  it('normalizes swapped min/max', () => {
    const band = normalizeComfortBounds(73, 67);
    assert.equal(band.tempLowF, 67);
    assert.equal(band.tempHighF, 73);
  });

  it('enforces minimum span', () => {
    const band = normalizeComfortBounds(70, 70);
    assert.equal(band.tempHighF - band.tempLowF, COMFORT_MIN_SPAN_F);
  });

  it('uses defaults for non-finite input', () => {
    const band = normalizeComfortBounds(Number.NaN, undefined);
    assert.equal(band.tempLowF, COMFORT_DEFAULT_MIN_F);
    assert.equal(band.tempHighF, COMFORT_DEFAULT_MAX_F);
  });

  it('derives legacy target bounds', () => {
    const band = comfortBoundsFromLegacyTarget(70);
    assert.equal(band.tempLowF, 67);
    assert.equal(band.tempHighF, 73);
  });
});

describe('temperature conversion and formatting', () => {
  it('converts Celsius to Fahrenheit and back', () => {
    assert.equal(toFahrenheit(0, 'c'), 32);
    assert.equal(toFahrenheit(100, 'c'), 212);
    assert.equal(fromFahrenheit(32, 'c'), 0);
    assert.equal(fromFahrenheit(212, 'c'), 100);
  });

  it('formats temperatures in F and C', () => {
    assert.equal(formatTemp(72, 'f'), '72°F');
    assert.equal(formatTemp(68, 'c'), '20°C');
    assert.equal(formatTemp(null, 'f'), 'N/A');
  });

  it('formats deltas and differences', () => {
    assert.equal(formatDelta(5, 'f'), '5°F');
    assert.equal(formatDelta(-9, 'c'), '5°C');
    assert.equal(formatTempDifference(68, 72, 'f'), '4°F cooler outside');
    assert.equal(formatTempDifference(72, 72, 'f'), 'About the same');
    assert.equal(formatComfortRange(67, 73, 'f'), '67°F-73°F');
  });

  it('formats dew point and ventilation shift strings', () => {
    assert.equal(formatDewPointDifference(50, 58, 'f'), 'Outdoor dew point 8°F lower');
    assert.equal(formatDewPointDifference(60, 50, 'f'), 'Outdoor dew point 10°F higher');
    assert.equal(formatVentilationShift(0, 'f'), 'little air-temp change');
    assert.equal(formatVentilationShift(-3, 'f'), 'roughly 3°F cooler');
    assert.equal(formatVentilationShift(2.5, 'c'), 'roughly 1.4°C warmer');
    assert.match(
      formatVentilationShift(-18, 'f', { capped: true }),
      /won't reach outdoor temp/,
    );
    assert.ok(
      estimateSolarHeatingShiftF({
        solarIntensity: 1,
        weather: 'clear',
        indoorTempF: 75,
        outdoorTempF: 75,
      }) >= 3,
    );
    assert.equal(estimateInternalGainShiftF(['maintain']), INTERNAL_GAIN_SHIFT_F);
    assert.equal(estimateInternalGainShiftF(['warm']), 0);
  });
});

describe('dew point and moisture helpers', () => {
  it('computes dew point in Fahrenheit', () => {
    const dp = dewPointFahrenheit(72, 50);
    assert.ok(dp > 50 && dp < 60);
  });

  it('returns null for invalid humidity', () => {
    assert.equal(dewPointFahrenheit(72, 101), null);
  });

  it('detects much drier outdoor air', () => {
    assert.equal(isMuchDrierOutdoor(72, 60, 68, 35), true);
    assert.equal(isMuchDrierOutdoor(72, 50, 70, 48), false);
  });

  it('computes absolute humidity', () => {
    const ah = absoluteHumidityGpm3(72, 50);
    assert.ok(ah > 0 && Number.isFinite(ah));
  });
});

describe('inferIndoorNeeds', () => {
  it('detects cool, warm, dehumidify, and humidify goals', () => {
    assert.deepEqual(inferIndoorNeeds(78, 45, 67, 73), ['cool']);
    assert.deepEqual(inferIndoorNeeds(64, 45, 67, 73), ['warm']);
    assert.deepEqual(inferIndoorNeeds(72, 55, 67, 73), ['dehumidify', 'maintain']);
    assert.deepEqual(inferIndoorNeeds(72, 25, 67, 73), ['humidify', 'maintain']);
  });

  it('defaults to maintain when comfortable', () => {
    assert.deepEqual(inferIndoorNeeds(70, 45, 67, 73), ['maintain']);
  });

  it('combines cool and dehumidify when hot and humid', () => {
    assert.deepEqual(inferIndoorNeeds(78, 62, 67, 73), ['cool', 'dehumidify']);
  });
});

describe('estimateVentilationTempShiftF', () => {
  it('returns zero for matched temperatures', () => {
    assert.equal(estimateVentilationTempShiftF(72, 72), 0);
    assert.equal(estimateVentilationTempShiftF(72, 72.4), 0);
  });

  it('shifts toward outdoor air with partial mixing', () => {
    const shift = estimateVentilationTempShiftF(78, 68);
    assert.ok(shift < 0);
    assert.ok(Math.abs(shift) < 10);
  });

  it('does not cap modest indoor/outdoor gaps', () => {
    assert.equal(estimateVentilationTempShiftF(78, 68), -4);
    assert.equal(estimateVentilationTempShiftF(72, 45), -13.5);
  });

  it('caps extreme gaps at VENTILATION_MAX_SHIFT_F', () => {
    assert.equal(estimateVentilationTempShiftF(72, 10), -VENTILATION_MAX_SHIFT_F);
    assert.equal(ventilationShiftIsCapped(72, 10), true);
    assert.equal(ventilationShiftIsCapped(72, 45), false);
  });
});

describe('pickVerdict', () => {
  it('maps score thresholds to verdict levels', () => {
    assert.equal(pickVerdict(50).level, VERDICTS.strongGood.level);
    assert.equal(pickVerdict(45).level, 'strong-good');
    assert.equal(pickVerdict(22).level, 'good');
    assert.equal(pickVerdict(8).level, 'marginal');
    assert.equal(pickVerdict(-7).level, 'not-worth-it');
    assert.equal(pickVerdict(-25).level, 'likely-worse');
    assert.equal(pickVerdict(-26).level, 'avoid');
  });
});

describe('solar helpers', () => {
  const summerDate = normalizeLocalDate('2025-06-21');
  const testTzHours = -4;
  const testLonDeg = -75;

  it('parses local dates', () => {
    assert.ok(normalizeLocalDate('2025-06-21') instanceof Date);
    assert.equal(normalizeLocalDate('not-a-date'), null);
  });

  it('computes sunrise and sunset ordering', () => {
    const { sunriseMinutes, sunsetMinutes } = getSunriseSunsetLocalMinutes(
      40,
      summerDate,
      testLonDeg,
      testTzHours,
    );
    assert.ok(sunriseMinutes < sunsetMinutes);
    assert.ok(sunriseMinutes > 3 * 60);
    assert.ok(sunsetMinutes > 19 * 60);
  });

  it('estimates realistic sunset for eastern US summer (not noon-centered)', () => {
    const date = normalizeLocalDate('2025-06-22');
    const { sunsetMinutes } = getSunriseSunsetLocalMinutes(41.88, date, -75, -4);
    assert.ok(sunsetMinutes > 20 * 60 + 20);
    assert.ok(sunsetMinutes < 21 * 60);
    assert.ok(!describeSunlightWindow(41.88, '2025-06-22', -75).includes('19:32'));
  });

  it('returns zero solar intensity at night', () => {
    assert.equal(getSolarIntensityFactor(40, summerDate, 2 * 60, testLonDeg, testTzHours), 0);
    assert.equal(getSolarIntensityFactor(40, summerDate, 23 * 60, testLonDeg, testTzHours), 0);
    const { sunsetMinutes } = getSunriseSunsetLocalMinutes(
      40,
      summerDate,
      testLonDeg,
      testTzHours,
    );
    assert.equal(
      getSolarIntensityFactor(40, summerDate, sunsetMinutes + 15, testLonDeg, testTzHours),
      0,
    );
  });

  it('returns higher intensity near solar noon', () => {
    const { sunriseMinutes, sunsetMinutes } = getSunriseSunsetLocalMinutes(
      40,
      summerDate,
      testLonDeg,
      testTzHours,
    );
    const noon = (sunriseMinutes + sunsetMinutes) / 2;
    const morning = sunriseMinutes + 60;
    assert.ok(
      getSolarIntensityFactor(40, summerDate, noon, testLonDeg, testTzHours) >
        getSolarIntensityFactor(40, summerDate, morning, testLonDeg, testTzHours),
    );
  });

  it('defaults solar intensity when inputs are missing', () => {
    assert.equal(resolveSolarIntensity(40, null, null), 1);
    assert.equal(resolveSolarIntensity(Number.NaN, '2025-06-21', 720), 1);
  });

  it('applies weather solar multipliers', () => {
    assert.equal(weatherSolarMultiplier('clear'), 1);
    assert.equal(weatherSolarMultiplier('partly-cloudy'), 0.55);
    assert.equal(weatherSolarMultiplier('cloudy'), 0.12);
    assert.equal(weatherSolarMultiplier('rainy'), 0.05);
  });

  it('formats solar heating metric for night and clear skies', () => {
    assert.equal(formatSolarHeatingMetric(0, 0, 'clear'), 'None (night)');
    assert.match(formatSolarHeatingMetric(0.8, 0.8, 'clear'), /clear skies/);
  });
});

describe('scoreTemperature', () => {
  it('rewards cooling when indoor is above comfort max', () => {
    const factor = scoreTemperature(78, 68, ['cool'], 'f', 50, 45, 67, 73);
    assert.equal(factor.impact, 'help');
    assert.ok(factor.score > 0);
  });

  it('penalizes warming when indoor needs cooling', () => {
    const factor = scoreTemperature(74, 82, ['cool'], 'f', 52, 55, 67, 73);
    assert.equal(factor.impact, 'hurt');
    assert.ok(factor.score < 0);
  });

  it('handles maintain band with modest outdoor cooling', () => {
    const factor = scoreTemperature(72, 64, ['maintain'], 'f', 50, 45, 67, 73);
    assert.ok(['help', 'mixed', 'neutral'].includes(factor.impact));
    assert.ok(factor.score >= 0);
  });

  it('uses maintain-band scoring when dehumidifying in comfort range', () => {
    const factor = scoreTemperature(
      72,
      55,
      ['dehumidify', 'maintain'],
      'f',
      62,
      45,
      67,
      73,
    );
    assert.ok(factor.score > 0);
    assert.match(factor.title, /comfort|fresh|range|cool/i);
  });

  it('penalizes modest net warming in maintain band', () => {
    const factor = scoreTemperature(
      75,
      72,
      ['dehumidify', 'maintain'],
      'f',
      53,
      50,
      68,
      78,
      {
        solarIntensity: 1,
        weather: 'clear',
        solarHeatingShiftF: 0.36,
        internalGainShiftF: 1.25,
      },
    );
    assert.ok(factor.score < 0);
    assert.match(factor.title, /warming/i);
  });
});

describe('scoreHumidity', () => {
  it('rewards drier outdoor air when dehumidifying', () => {
    const factor = scoreHumidity(72, 62, 68, 35, ['dehumidify']);
    assert.equal(factor.impact, 'help');
    assert.ok(factor.score >= 25);
    assert.ok(Number.isFinite(factor.indoorDp));
  });

  it('penalizes moister outdoor air when dehumidifying', () => {
    const factor = scoreHumidity(72, 62, 74, 70, ['dehumidify']);
    assert.equal(factor.impact, 'hurt');
    assert.ok(factor.score < 0);
  });

  it('supports humidify goal', () => {
    const factor = scoreHumidity(72, 25, 70, 55, ['humidify', 'maintain']);
    assert.ok(['help', 'neutral', 'mixed'].includes(factor.impact));
  });
});

describe('scoreCondensationRisk', () => {
  it('flags high condensation risk in cold weather', () => {
    const factor = scoreCondensationRisk(70, 60, 35, 80, 'f');
    assert.equal(factor.impact, 'hurt');
    assert.ok(factor.score <= -22);
  });

  it('reports low risk when dew point margin is small', () => {
    const factor = scoreCondensationRisk(72, 45, 68, 50, 'f');
    assert.equal(factor.impact, 'neutral');
    assert.equal(factor.score, 0);
  });
});

describe('scoreWeather', () => {
  it('rewards breeze when maintaining with cool outdoor air', () => {
    const factor = scoreWeather(
      'cloudy',
      75,
      53,
      64,
      59,
      ['dehumidify', 'maintain'],
      0.9,
      67,
      78,
      true,
      15,
    );
    assert.equal(factor.title, 'Breeze improves air exchange');
    assert.equal(factor.impact, 'help');
  });

  it('suppresses solar bonus at night on cloudy days', () => {
    const factor = scoreWeather(
      'cloudy',
      75,
      53,
      70,
      59,
      ['dehumidify', 'maintain'],
      0,
      71,
      78,
    );
    assert.equal(factor.title, 'Dark outside -- no solar heating');
    assert.equal(factor.score, 0);
  });

  it('handles partly-cloudy daytime cooling', () => {
    const factor = scoreWeather(
      'partly-cloudy',
      78,
      50,
      70,
      45,
      ['cool'],
      0.6,
      67,
      73,
    );
    assert.ok(factor);
    assert.ok(['help', 'mixed', 'hurt', 'neutral'].includes(factor.impact));
  });
});

describe('buildHeadline and buildSummary', () => {
  it('builds goal-aware headlines', () => {
    const headline = buildHeadline(VERDICTS.good, ['cool', 'dehumidify']);
    assert.match(headline, /cool down and dry out/i);
  });

  it('builds summaries from factor impacts', () => {
    const summary = buildSummary(
      VERDICTS.good,
      { impact: 'help' },
      { impact: 'help' },
      { impact: 'neutral' },
      { impact: 'help' },
    );
    assert.match(summary, /temperature looks favorable/i);
    assert.match(summary, /Natural ventilation should move indoor conditions/i);
  });

  it('adds cautious wording for marginal verdicts', () => {
    const summary = buildSummary(
      VERDICTS.marginal,
      { impact: 'mixed' },
      { impact: 'neutral' },
      { impact: 'neutral' },
      { impact: 'neutral' },
    );
    assert.match(summary, /modest gains|small/i);
  });
});

describe('evaluateConditions integration', () => {
  it('evaluates a classic evening cool-down', () => {
    const result = evaluateConditions({
      indoorTempF: 78,
      outdoorTempF: 68,
      indoorRh: 55,
      outdoorRh: 45,
      weather: 'clear',
      unit: 'f',
    });
    assert.ok(result.needs.includes('dehumidify'));
    assert.ok(result.needs.includes('maintain'));
    assert.ok(!result.needs.includes('cool'));
    assert.ok(['strong-good', 'good'].includes(result.verdict.level));
    assert.ok(result.totalScore >= 22);
    assert.ok(result.ventilationShiftF < 0);
    assert.ok(result.estimatedIndoorF < 78);
  });

  it('accepts Celsius unit for formatting without changing physics', () => {
    const result = evaluateConditions({
      indoorTempF: 78,
      outdoorTempF: 68,
      indoorRh: 55,
      outdoorRh: 45,
      weather: 'cloudy',
      unit: 'c',
    });
    assert.match(result.tempFactor.body ?? result.tempFactor.title, /°C|C/);
  });

  it('adds dehumidify goal when RH exceeds target even in temp band', () => {
    const result = evaluateConditions({
      indoorTempF: 72,
      outdoorTempF: 68,
      indoorRh: 52,
      outdoorRh: 55,
      weather: 'cloudy',
      comfortMinF: 67,
      comfortMaxF: 75,
    });
    assert.ok(result.needs.includes('dehumidify'));
    assert.ok(result.needs.includes('maintain'));
  });

  it('total score equals sum of factor scores', () => {
    const result = evaluateConditions({
      indoorTempF: 76,
      outdoorTempF: 65,
      indoorRh: 48,
      outdoorRh: 40,
      weather: 'cloudy',
    });
    const sum =
      result.tempFactor.score +
      result.humidityFactor.score +
      result.condensationFactor.score +
      result.weatherFactor.score;
    assert.equal(result.totalScore, sum);
  });

  it('respects custom comfort band and solar inputs', () => {
    const result = evaluateConditions({
      indoorTempF: 75,
      outdoorTempF: 64,
      indoorRh: 53,
      outdoorRh: 59,
      weather: 'clear',
      comfortMinF: 70,
      comfortMaxF: 78,
      latitudeDeg: 41,
      localDate: '2026-06-22',
      localTimeMinutes: 15 * 60,
    });
    assert.equal(result.comfortBand.tempLowF, 70);
    assert.equal(result.comfortBand.tempHighF, 78);
    assert.ok(result.solarIntensity > 0.5);
  });
});

describe('isNullish', () => {
  it('detects null and undefined only', () => {
    assert.equal(isNullish(null), true);
    assert.equal(isNullish(undefined), true);
    assert.equal(isNullish(0), false);
    assert.equal(isNullish(''), false);
  });
});

describe('COMFORT constants', () => {
  it('uses 50% as RH target ceiling', () => {
    assert.equal(COMFORT.rhTargetMax, 50);
    assert.equal(COMFORT.rhLow, 30);
  });
});
