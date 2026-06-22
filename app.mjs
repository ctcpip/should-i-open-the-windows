const COMFORT = {
  rhLow: 30,
  /** Target ceiling — above this feels stuffy/muggy even when temperature is fine. */
  rhTargetMax: 50,
  /** Legacy alias used in comparisons. */
  rhIdealHigh: 50,
  rhHigh: 50,
};

const COMFORT_DEFAULT_MIN_F = 67;
const COMFORT_DEFAULT_MAX_F = 73;
const COMFORT_MIN_SPAN_F = 2;
const COMFORT_LEGACY_TOLERANCE_F = 3;

function isNullish(value) {
  return value === null || typeof value === 'undefined';
}

function normalizeComfortBounds(comfortMinF, comfortMaxF) {
  let tempLowF = Number.isFinite(comfortMinF) ? comfortMinF : COMFORT_DEFAULT_MIN_F;
  let tempHighF = Number.isFinite(comfortMaxF) ? comfortMaxF : COMFORT_DEFAULT_MAX_F;

  if (tempLowF > tempHighF) {
    [tempLowF, tempHighF] = [tempHighF, tempLowF];
  }

  if (tempHighF - tempLowF < COMFORT_MIN_SPAN_F) {
    tempHighF = tempLowF + COMFORT_MIN_SPAN_F;
  }

  return {
    tempLowF,
    tempHighF,
    midpointF: (tempLowF + tempHighF) / 2,
  };
}

function comfortBoundsFromLegacyTarget(comfortTargetF) {
  const target = Number.isFinite(comfortTargetF) ? comfortTargetF : COMFORT_DEFAULT_MIN_F + COMFORT_MIN_SPAN_F;
  return normalizeComfortBounds(
    target - COMFORT_LEGACY_TOLERANCE_F,
    target + COMFORT_LEGACY_TOLERANCE_F,
  );
}

function formatComfortRange(tempLowF, tempHighF, unit) {
  return `${formatTemp(tempLowF, unit)}-${formatTemp(tempHighF, unit)}`;
}

/** Realistic max °F shift for a whole home with sustained window ventilation (not full equilibration). */
const VENTILATION_MAX_SHIFT_F = 6;
const DEFAULT_LATITUDE_DEG = 40;
const TWILIGHT_MINUTES = 30;

function normalizeLocalDate(input) {
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return new Date(input.getFullYear(), input.getMonth(), input.getDate());
  }
  if (typeof input !== 'string' || !input) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day);
}

function dayOfYearFromDate(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function getSunriseSunsetLocalMinutes(latitudeDeg, date) {
  const latRad = (latitudeDeg * Math.PI) / 180;
  const dayOfYear = dayOfYearFromDate(date);
  const declRad =
    ((23.45 * Math.PI) / 180) * Math.sin(((2 * Math.PI) / 365) * (284 + dayOfYear));
  let cosHourAngle = -Math.tan(latRad) * Math.tan(declRad);
  cosHourAngle = Math.max(-1, Math.min(1, cosHourAngle));
  const hourAngleDeg = (Math.acos(cosHourAngle) * 180) / Math.PI;
  const halfDayMinutes = (hourAngleDeg / 15) * 60;
  const solarNoon = 12 * 60;
  return {
    sunriseMinutes: solarNoon - halfDayMinutes,
    sunsetMinutes: solarNoon + halfDayMinutes,
  };
}

function getSolarIntensityFactor(latitudeDeg, date, timeMinutes) {
  const { sunriseMinutes, sunsetMinutes } = getSunriseSunsetLocalMinutes(latitudeDeg, date);

  if (timeMinutes <= sunriseMinutes - TWILIGHT_MINUTES) return 0;
  if (timeMinutes >= sunsetMinutes + TWILIGHT_MINUTES) return 0;

  if (timeMinutes < sunriseMinutes) {
    return ((timeMinutes - (sunriseMinutes - TWILIGHT_MINUTES)) / TWILIGHT_MINUTES) * 0.25;
  }
  if (timeMinutes > sunsetMinutes) {
    return ((sunsetMinutes + TWILIGHT_MINUTES - timeMinutes) / TWILIGHT_MINUTES) * 0.25;
  }

  const noon = (sunriseMinutes + sunsetMinutes) / 2;
  const halfSpan = (sunsetMinutes - sunriseMinutes) / 2;
  if (halfSpan <= 0) return 0;
  const t = (timeMinutes - noon) / halfSpan;
  return Math.cos((t * Math.PI) / 2);
}

function resolveSolarIntensity(latitudeDeg, localDate, localTimeMinutes) {
  const date = normalizeLocalDate(localDate);
  if (
    !date ||
    isNullish(localTimeMinutes) ||
    !Number.isFinite(localTimeMinutes) ||
    !Number.isFinite(latitudeDeg)
  ) {
    return 1;
  }
  return getSolarIntensityFactor(latitudeDeg, date, localTimeMinutes);
}

function formatClockFromMinutes(minutes) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = Math.round(minutes % 60);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function weatherSolarMultiplier(weather) {
  switch (weather) {
    case 'clear':
      return 1;
    case 'partly-cloudy':
      return 0.55;
    case 'cloudy':
      return 0.12;
    case 'rainy':
      return 0.05;
    case 'windy':
      return 1;
    default:
      return 1;
  }
}

function weatherSolarContext(weather) {
  switch (weather) {
    case 'clear':
      return 'clear skies';
    case 'partly-cloudy':
      return 'partly cloudy';
    case 'cloudy':
      return 'overcast';
    case 'rainy':
      return 'rain';
    default:
      return null;
  }
}

function formatSolarHeatingStrength(intensity) {
  if (intensity <= 0.05) return 'none';
  if (intensity <= 0.18) return 'minimal';
  if (intensity <= 0.38) return 'mild';
  if (intensity <= 0.65) return 'moderate';
  return 'strong';
}

function capitalizeWord(word) {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function formatSolarHeatingMetric(effectiveIntensity, skyIntensity, weather) {
  if (skyIntensity <= 0.05) return 'None (night)';

  if (weather === 'windy') {
    const skyStrength = formatSolarHeatingStrength(skyIntensity);
    return `${capitalizeWord(skyStrength)} (time only)`;
  }

  const strength = formatSolarHeatingStrength(effectiveIntensity);
  const context = weatherSolarContext(weather);
  if (context) return `${capitalizeWord(strength)} (${context})`;
  return capitalizeWord(strength);
}

function describeSunlightWindow(latitudeDeg, localDate) {
  const date = normalizeLocalDate(localDate);
  if (!date || !Number.isFinite(latitudeDeg)) {
    return 'Set date and latitude to estimate sunrise and sunset.';
  }
  const { sunriseMinutes, sunsetMinutes } = getSunriseSunsetLocalMinutes(latitudeDeg, date);
  return `Sunrise ~${formatClockFromMinutes(sunriseMinutes)}, sunset ~${formatClockFromMinutes(sunsetMinutes)}`;
}

function scaleSolarFactor(factor, solarIntensity) {
  if (!factor) return null;
  return {
    ...factor,
    score: Math.round(factor.score * solarIntensity),
  };
}

function estimateVentilationTempShiftF(indoorTempF, outdoorTempF) {
  const delta = outdoorTempF - indoorTempF;
  const absDelta = Math.abs(delta);
  if (absDelta < 0.5) return 0;

  let fraction;
  if (absDelta <= 3) fraction = 0.2;
  else if (absDelta <= 6) fraction = 0.3;
  else if (absDelta <= 12) fraction = 0.4;
  else if (absDelta <= 20) fraction = 0.45;
  else fraction = 0.5;

  let shift = delta * fraction;
  if (Math.abs(shift) > VENTILATION_MAX_SHIFT_F) {
    shift = Math.sign(shift) * VENTILATION_MAX_SHIFT_F;
  }
  return shift;
}

function formatVentilationShift(shiftF, unit) {
  if (Math.abs(shiftF) < 0.5) return 'little change';
  if (shiftF < 0) return `roughly ${formatDelta(-shiftF, unit)} cooler`;
  return `roughly ${formatDelta(shiftF, unit)} warmer`;
}

function scoreTemperatureMaintainBand(indoorTempF, outdoorTempF, tempLowF, tempHighF, unit) {
  const delta = outdoorTempF - indoorTempF;
  const absDelta = Math.abs(delta);
  const shiftF = estimateVentilationTempShiftF(indoorTempF, outdoorTempF);
  const estIndoorF = indoorTempF + shiftF;
  const absShift = Math.abs(shiftF);
  const outdoorNote = ` (outdoor is ${formatTemp(outdoorTempF, unit)}, but the whole home won't reach that)`;

  if (absDelta <= 2 || absShift < 0.5) {
    return {
      score: 3,
      impact: 'neutral',
      title: 'Temperature already matched',
      body: 'Indoor and outdoor temps are close — expect little temperature change from ventilation.',
      shiftF,
    };
  }

  const estInBand = estIndoorF >= tempLowF && estIndoorF <= tempHighF;
  const estBelowMin = tempLowF - estIndoorF;
  const estAboveMax = estIndoorF - tempHighF;

  if (estInBand) {
    const cooler = shiftF < -0.5;
    const score = absShift <= 2 ? 18 : absShift <= 5 ? 16 : 12;
    return {
      score,
      impact: cooler ? 'mixed' : 'help',
      title: cooler ? 'Good for fresh air — modest shift expected' : 'Ventilation should stay comfortable',
      body: cooler
        ? `Expect ${formatVentilationShift(shiftF, unit)} indoors — likely still within your ${formatComfortRange(tempLowF, tempHighF, unit)} range${outdoorNote}.`
        : `Expect ${formatVentilationShift(shiftF, unit)} indoors — should stay within your comfort range.`,
      shiftF,
    };
  }

  if (estBelowMin > 0) {
    if (estBelowMin <= 1.5) {
      return {
        score: 12,
        impact: 'mixed',
        title: 'Slight dip below your range',
        body: `Expect ${formatVentilationShift(shiftF, unit)} indoors — possibly a touch below your ${formatTemp(tempLowF, unit)} minimum if left open long${outdoorNote}.`,
        shiftF,
      };
    }
    if (estBelowMin <= 3) {
      return {
        score: 2,
        impact: 'mixed',
        title: 'Some cooling below your minimum',
        body: `Expect ${formatVentilationShift(shiftF, unit)} indoors — may drift below your ${formatTemp(tempLowF, unit)} floor${outdoorNote}.`,
        shiftF,
      };
    }
    return {
      score: estBelowMin >= 5 ? -28 : -14,
      impact: estBelowMin >= 5 ? 'hurt' : 'mixed',
      title: 'Likely too much cooling',
      body: `Expect ${formatVentilationShift(shiftF, unit)} indoors — probably below your ${formatTemp(tempLowF, unit)} minimum${outdoorNote}.`,
      shiftF,
    };
  }

  if (estAboveMax > 0) {
    if (estAboveMax <= 1.5) {
      return {
        score: 10,
        impact: 'mixed',
        title: 'Slight rise above your range',
        body: `Expect ${formatVentilationShift(shiftF, unit)} indoors — possibly a touch above your ${formatTemp(tempHighF, unit)} maximum if left open long${outdoorNote}.`,
        shiftF,
      };
    }
    if (estAboveMax <= 3) {
      return {
        score: 0,
        impact: 'mixed',
        title: 'Some warming above your maximum',
        body: `Expect ${formatVentilationShift(shiftF, unit)} indoors — may drift above your ${formatTemp(tempHighF, unit)} ceiling${outdoorNote}.`,
        shiftF,
      };
    }
    return {
      score: estAboveMax >= 5 ? -24 : -12,
      impact: estAboveMax >= 5 ? 'hurt' : 'mixed',
      title: 'Likely too much warming',
      body: `Expect ${formatVentilationShift(shiftF, unit)} indoors — probably above your ${formatTemp(tempHighF, unit)} maximum${outdoorNote}.`,
      shiftF,
    };
  }

  return {
    score: 0,
    impact: 'neutral',
    title: 'Temperature impact is neutral',
    body: 'Ventilation is unlikely to move indoor temperature much.',
    shiftF,
  };
}

const VERDICTS = {
  strongGood: {
    level: 'strong-good',
    badge: 'Strong yes',
    cssClass: 'verdict--strong-good',
  },
  good: {
    level: 'good',
    badge: 'Worth opening',
    cssClass: 'verdict--good',
  },
  marginal: {
    level: 'marginal',
    badge: 'Marginal / maybe',
    cssClass: 'verdict--neutral',
  },
  notWorthIt: {
    level: 'not-worth-it',
    badge: 'Probably not worth it',
    cssClass: 'verdict--neutral',
  },
  likelyWorse: {
    level: 'likely-worse',
    badge: 'Likely worse',
    cssClass: 'verdict--mild-bad',
  },
  avoid: {
    level: 'avoid',
    badge: 'Avoid opening',
    cssClass: 'verdict--bad',
  },
};

const STORAGE_KEY = 'should-i-open-the-windows:inputs';

const WEATHER_OPTIONS = new Set([
  'clear',
  'partly-cloudy',
  'cloudy',
  'rainy',
  'windy',
]);

const elements = {
  unitInputs: document.querySelectorAll('input[name="unit"]'),
  unitLabels: document.querySelectorAll('.unit-label[data-unit=\'temp\']'),
  indoorTemp: document.getElementById('indoor-temp'),
  indoorHumidity: document.getElementById('indoor-humidity'),
  outdoorTemp: document.getElementById('outdoor-temp'),
  outdoorHumidity: document.getElementById('outdoor-humidity'),
  weather: document.getElementById('weather'),
  localDate: document.getElementById('local-date'),
  localTime: document.getElementById('local-time'),
  latitude: document.getElementById('latitude'),
  sunlightHint: document.getElementById('sunlight-hint'),
  evaluateBtn: document.getElementById('evaluate-btn'),
  resultsPlaceholder: document.getElementById('results-placeholder'),
  results: document.getElementById('results'),
  verdict: document.getElementById('verdict'),
  verdictBadge: document.getElementById('verdict-badge'),
  verdictHeadline: document.getElementById('verdict-headline'),
  verdictSummary: document.getElementById('verdict-summary'),
  metrics: document.getElementById('metrics'),
  factors: document.getElementById('factors'),
  validationError: document.getElementById('validation-error'),
  comfortMin: document.getElementById('comfort-min'),
  comfortMax: document.getElementById('comfort-max'),
  comfortRangeDisplay: document.getElementById('comfort-range-display'),
  comfortRangeHint: document.getElementById('comfort-range-hint'),
};

const NEED_LABELS = {
  cool: 'Cool down',
  warm: 'Warm up',
  dehumidify: 'Lower humidity',
  humidify: 'Add moisture',
  maintain: 'Stay comfortable',
};

function describeNeeds(needs) {
  return needs.map((need) => NEED_LABELS[need] || need).join(', ');
}

function showValidation(message) {
  if (!elements.validationError) return;
  if (!message) {
    elements.validationError.hidden = true;
    elements.validationError.textContent = '';
    return;
  }
  elements.validationError.textContent = message;
  elements.validationError.hidden = false;
}

function getUnit() {
  const selected = document.querySelector('input[name="unit"]:checked');
  return selected ? selected.value : 'f';
}

function toFahrenheit(value, unit) {
  return unit === 'c' ? value * (9 / 5) + 32 : value;
}

function fromFahrenheit(valueF, unit) {
  return unit === 'c' ? ((valueF - 32) * 5) / 9 : valueF;
}

function formatTemp(valueF, unit) {
  if (isNullish(valueF) || !Number.isFinite(valueF)) return 'N/A';
  const value = fromFahrenheit(valueF, unit);
  const rounded = unit === 'c' ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded}°${unit === 'c' ? 'C' : 'F'}`;
}

function formatDelta(deltaF, unit) {
  const magnitude = unit === 'c' ? Math.abs((deltaF * 5) / 9) : Math.abs(deltaF);
  const rounded = unit === 'c' ? Math.round(magnitude * 10) / 10 : Math.round(magnitude);
  return `${rounded}°${unit === 'c' ? 'C' : 'F'}`;
}

function dewPointCelsius(tempC, rh) {
  if (rh <= 0) return -40;
  if (rh > 100) return null;
  const a = 17.27;
  const b = 237.7;
  const alpha = (a * tempC) / (b + tempC) + Math.log(rh / 100);
  return (b * alpha) / (a - alpha);
}

function dewPointFahrenheit(tempF, rh) {
  const tempC = ((tempF - 32) * 5) / 9;
  const dpC = dewPointCelsius(tempC, rh);
  return dpC === null ? null : (dpC * 9) / 5 + 32;
}

function absoluteHumidityGpm3(tempF, rh) {
  const tempC = ((tempF - 32) * 5) / 9;
  const saturationPressure = 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
  const vaporPressure = (rh / 100) * saturationPressure;
  const absHumidity = (216.7 * vaporPressure) / (tempC + 273.15);
  return absHumidity;
}

function getDewPoints(indoorTempF, indoorRh, outdoorTempF, outdoorRh) {
  return {
    indoorDp: dewPointFahrenheit(indoorTempF, indoorRh),
    outdoorDp: dewPointFahrenheit(outdoorTempF, outdoorRh),
  };
}

/** Outdoor dew point at least thresholdF lower than indoor — ventilation can dry the home. */
function isMuchDrierOutdoor(indoorTempF, indoorRh, outdoorTempF, outdoorRh, thresholdF = 8) {
  const { indoorDp, outdoorDp } = getDewPoints(indoorTempF, indoorRh, outdoorTempF, outdoorRh);
  return indoorDp !== null && outdoorDp !== null && outdoorDp <= indoorDp - thresholdF;
}

function inferIndoorNeeds(indoorTempF, indoorRh, comfortMinF, comfortMaxF) {
  const { tempLowF, tempHighF } = normalizeComfortBounds(comfortMinF, comfortMaxF);
  const needs = [];
  const inTempBand = indoorTempF >= tempLowF && indoorTempF <= tempHighF;

  if (indoorTempF > tempHighF) {
    needs.push('cool');
  }
  else if (indoorTempF < tempLowF) {
    needs.push('warm');
  }

  if (indoorRh > COMFORT.rhTargetMax) {
    needs.push('dehumidify');
  }
  else if (indoorRh < COMFORT.rhLow) {
    needs.push('humidify');
  }

  if (needs.length === 0) {
    needs.push('maintain');
  }
  else if (inTempBand && !needs.includes('cool') && !needs.includes('warm')) {
    needs.push('maintain');
  }

  return needs;
}

function formatTempDifference(outdoorTempF, indoorTempF, unit) {
  const delta = outdoorTempF - indoorTempF;
  if (Math.abs(delta) < 0.5) return 'About the same';
  if (delta < 0) return `${formatDelta(-delta, unit)} cooler outside`;
  return `${formatDelta(delta, unit)} warmer outside`;
}

function formatDewPointDifference(outdoorDpF, indoorDpF, unit) {
  if (isNullish(outdoorDpF) || isNullish(indoorDpF)) return 'N/A';
  const delta = outdoorDpF - indoorDpF;
  if (Math.abs(delta) < 0.5) return 'About the same';
  if (delta < 0) return `${formatDelta(-delta, unit)} drier outside`;
  return `${formatDelta(delta, unit)} moister outside`;
}

function scoreTemperatureForMoistureGoal(
  indoorTempF,
  indoorRh,
  outdoorTempF,
  outdoorRh,
  needs,
  unit,
) {
  const delta = outdoorTempF - indoorTempF;
  const absDelta = Math.abs(delta);
  const indoorDp = dewPointFahrenheit(indoorTempF, indoorRh);
  const outdoorDp = dewPointFahrenheit(outdoorTempF, outdoorRh);
  if (indoorDp === null || outdoorDp === null) return null;

  const dpDelta = outdoorDp - indoorDp;
  const dehumidifyOnly =
    needs.includes('dehumidify') && !needs.includes('cool') && !needs.includes('warm');
  const humidifyOnly =
    needs.includes('humidify') && !needs.includes('cool') && !needs.includes('warm');

  if (dehumidifyOnly) {
    if (dpDelta <= -8) {
      if (absDelta >= 15) {
        return {
          score: 4,
          impact: 'mixed',
          title: 'Cold, dry outdoor air can help dry the home',
          body: `Outdoor dew point is much lower even though air is ${formatDelta(-delta, unit)} cooler — ventilation trades warmth for moisture removal; short bursts work best.`,
        };
      }
      return {
        score: 12,
        impact: 'help',
        title: 'Outdoor air supports drying',
        body: 'Drier outdoor air should pull moisture out of the home without a large temperature penalty.',
      };
    }
    if (dpDelta >= 3) {
      return {
        score: -18,
        impact: 'hurt',
        title: 'Outdoor air is too moist to help dry the home',
        body: 'Ventilation will not improve humidity and may only change indoor temperature.',
      };
    }
    if (absDelta >= 10) {
      return {
        score: -10,
        impact: 'mixed',
        title: 'Large temperature swing for limited drying benefit',
        body: 'Outdoor moisture levels are not dry enough to justify a big indoor temperature change.',
      };
    }
    return {
      score: 0,
      impact: 'neutral',
      title: 'Temperature change is secondary to drying',
      body: 'Moisture levels indoors and out are the main factor; temperature drift should stay modest.',
    };
  }

  if (humidifyOnly) {
    if (dpDelta >= 5) {
      return {
        score: 8,
        impact: 'mixed',
        title: 'Moister outdoor air may help slightly',
        body: 'Higher outdoor dew point can nudge indoor humidity up, though whole-house change will be slow.',
      };
    }
    if (dpDelta <= -5 && absDelta >= 8) {
      return {
        score: -15,
        impact: 'hurt',
        title: 'Cold, dry outdoor air worsens dry indoor air',
        body: `Outdoor air is ${formatDelta(-delta, unit)} cooler and drier — ventilation will strip humidity without warming meaningfully.`,
      };
    }
    return {
      score: -4,
      impact: 'neutral',
      title: 'Ventilation alone will not fix dry air quickly',
      body: 'Outdoor moisture is not high enough for windows to meaningfully humidify the home.',
    };
  }

  return null;
}

function scoreTemperature(
  indoorTempF,
  outdoorTempF,
  needs,
  unit,
  indoorRh,
  outdoorRh,
  comfortMinF,
  comfortMaxF,
) {
  const { tempLowF, tempHighF } = normalizeComfortBounds(comfortMinF, comfortMaxF);
  const delta = outdoorTempF - indoorTempF;
  const shiftF = estimateVentilationTempShiftF(indoorTempF, outdoorTempF);
  const inComfortBand = indoorTempF >= tempLowF && indoorTempF <= tempHighF;

  if (needs.includes('cool')) {
    const stickyAndDrier =
      needs.includes('dehumidify') &&
      isMuchDrierOutdoor(indoorTempF, indoorRh, outdoorTempF, outdoorRh);

    if (delta <= -8) {
      return {
        score: 30,
        impact: 'help',
        title: 'Outdoor air is much cooler',
        body: `Outdoor air is ${formatDelta(-delta, unit)} cooler — expect ${formatVentilationShift(shiftF, unit)} indoors, though sunlight warming the home can offset some of the gain.`,
      };
    }
    if (delta <= -3) {
      return {
        score: 14,
        impact: 'mixed',
        title: 'Modest cooling from outdoor air',
        body: `Outdoor air is ${formatDelta(-delta, unit)} cooler. Expect ${formatVentilationShift(shiftF, unit)} indoors — gradual, and less than the full gap to outside.`,
      };
    }
    if (delta <= 1) {
      if (stickyAndDrier && delta > -3) {
        return {
          score: 8,
          impact: 'mixed',
          title: 'Slightly warmer outside, but much drier',
          body: 'Outdoor air is a touch warmer yet the dew point is notably lower — expect humidity relief with little or no cooling.',
        };
      }
      return {
        score: -5,
        impact: 'neutral',
        title: 'Little temperature benefit',
        body: 'Indoor and outdoor temperatures are nearly the same, so opening windows will not move the needle much on heat.',
      };
    }
    if (delta <= 6) {
      if (stickyAndDrier) {
        return {
          score: 2,
          impact: 'mixed',
          title: 'Warmer outside, but drier air may still help',
          body: `Outdoor air is ${formatDelta(delta, unit)} warmer, yet much lower dew point can ease stuffiness — cooling will be limited.`,
        };
      }
      return {
        score: -22,
        impact: 'hurt',
        title: 'Outdoor air is warmer — cooling will suffer',
        body: `You would be letting in air about ${formatDelta(delta, unit)} warmer than inside, working against your goal.`,
      };
    }
    if (stickyAndDrier && delta <= 10) {
      return {
        score: -8,
        impact: 'mixed',
        title: 'Warmer outside, but notably drier',
        body: `Outdoor air is ${formatDelta(delta, unit)} warmer — cooling suffers, but the lower dew point may still ease stuffiness.`,
      };
    }
    return {
      score: -40,
      impact: 'hurt',
      title: 'Outdoor air is much warmer',
      body: `Opening windows would admit air roughly ${formatDelta(delta, unit)} hotter — likely making the home warmer and stickier.`,
    };
  }

  if (needs.includes('warm')) {
    if (delta >= 8) {
      return {
        score: 12,
        impact: 'mixed',
        title: 'Outdoor air could warm the home slowly',
        body: `Outdoor air is ${formatDelta(delta, unit)} warmer, but window ventilation alone is a weak substitute for running heat — any gain will be uneven and slow.`,
      };
    }
    if (delta >= 3) {
      return {
        score: 4,
        impact: 'mixed',
        title: 'Limited warming from ventilation',
        body: 'Outdoor air is a bit warmer, but windows alone will not replace your heating system meaningfully.',
      };
    }
    if (delta >= -3) {
      return {
        score: -8,
        impact: 'neutral',
        title: 'Minimal warming help',
        body: 'Outdoor air is not much warmer than inside, so windows alone will not replace your heating.',
      };
    }
    if (delta >= -10) {
      return {
        score: -28,
        impact: 'hurt',
        title: 'Cold outdoor air will steal heat',
        body: `Outdoor air is about ${formatDelta(-delta, unit)} colder — expect ${formatVentilationShift(shiftF, unit)} indoors, not a full drop to outdoor temp.`,
      };
    }
    return {
      score: -45,
      impact: 'hurt',
      title: 'Very cold outdoor air',
      body: 'Letting in frigid air will overwhelm most heating and make rooms uncomfortable quickly.',
    };
  }

  const moistureGoal = scoreTemperatureForMoistureGoal(
    indoorTempF,
    indoorRh,
    outdoorTempF,
    outdoorRh,
    needs,
    unit,
  );

  const dehumidifyInBand =
    needs.includes('dehumidify') &&
    needs.includes('maintain') &&
    !needs.includes('cool') &&
    !needs.includes('warm');

  if (dehumidifyInBand && inComfortBand) {
    return scoreTemperatureMaintainBand(indoorTempF, outdoorTempF, tempLowF, tempHighF, unit);
  }

  if (moistureGoal) return moistureGoal;

  if (inComfortBand) {
    return scoreTemperatureMaintainBand(indoorTempF, outdoorTempF, tempLowF, tempHighF, unit);
  }

  return {
    score: 0,
    impact: 'neutral',
    title: 'Temperature impact is neutral',
    body: 'Indoor and outdoor temperatures are unlikely to shift comfort on their own.',
  };
}

function scoreHumidity(indoorTempF, indoorRh, outdoorTempF, outdoorRh, needs) {
  const indoorDp = dewPointFahrenheit(indoorTempF, indoorRh);
  const outdoorDp = dewPointFahrenheit(outdoorTempF, outdoorRh);
  const indoorAh = absoluteHumidityGpm3(indoorTempF, indoorRh);
  const outdoorAh = absoluteHumidityGpm3(outdoorTempF, outdoorRh);
  const dpDelta =
    indoorDp === null || outdoorDp === null ? 0 : outdoorDp - indoorDp;
  const ahDelta = outdoorAh - indoorAh;

  const withDewPoints = (factor) => ({ ...factor, indoorDp, outdoorDp });

  if (needs.includes('dehumidify')) {
    const aboveRhTarget = indoorRh > COMFORT.rhTargetMax;
    const stuffyNote = aboveRhTarget
      ? ` Indoor humidity (${Math.round(indoorRh)}%) is above your ~50% comfort target — dryness matters as much as temperature.`
      : '';

    if (dpDelta <= -5) {
      return withDewPoints({
        score: aboveRhTarget ? 28 : 25,
        impact: 'help',
        title: aboveRhTarget
          ? 'Outdoor air is drier — should ease stuffiness'
          : 'Outdoor air is drier — humidity should drop',
        body: `Lower outdoor dew point means incoming air can absorb moisture and help dry out stale indoor air.${stuffyNote}`,
      });
    }
    if (dpDelta <= -1) {
      return withDewPoints({
        score: aboveRhTarget ? 14 : 10,
        impact: 'mixed',
        title: aboveRhTarget
          ? 'Modest drying — may help muggy air'
          : 'Slight dehumidifying effect',
        body: `Outdoor moisture levels are a bit lower. You may feel modest relief, but it might not fix a very damp home on its own.${stuffyNote}`,
      });
    }
    if (dpDelta <= 3) {
      return withDewPoints({
        score: aboveRhTarget ? -14 : -8,
        impact: aboveRhTarget ? 'mixed' : 'neutral',
        title: aboveRhTarget
          ? 'Humidity already high — little relief expected'
          : 'Humidity levels are similar',
        body: aboveRhTarget
          ? `Indoor and outdoor moisture are close, so ventilation will not pull humidity below your ~50% target — the home may still feel stuffy.${stuffyNote}`
          : 'Indoor and outdoor moisture are close, so ventilation alone will not change humidity much.',
      });
    }
    return withDewPoints({
      score: aboveRhTarget ? -28 : -25,
      impact: 'hurt',
      title: 'Outdoor air is more humid',
      body: `Bringing in moister outdoor air will work against drying the home and can feel clammy.${stuffyNote}`,
    });
  }

  if (needs.includes('humidify')) {
    if (ahDelta >= 1.5) {
      return withDewPoints({
        score: 15,
        impact: 'help',
        title: 'Outdoor air carries more moisture',
        body: 'If the home feels dry, outdoor air may add a little humidity — though whole-house change will be gradual.',
      });
    }
    if (ahDelta >= -1) {
      return withDewPoints({
        score: -5,
        impact: 'neutral',
        title: 'Limited humidifying benefit',
        body: 'Outdoor air is not much moister than inside, so windows will not fix dry-air discomfort quickly.',
      });
    }
    return withDewPoints({
      score: -18,
      impact: 'hurt',
      title: 'Outdoor air is drier still',
      body: 'Ventilation will pull in drier air and can make skin, sinuses, and static issues worse.',
    });
  }

  if (Math.abs(dpDelta) <= 2) {
    return withDewPoints({
      score: 0,
      impact: 'neutral',
      title: 'Humidity is balanced',
      body: 'Dew points are similar, so moisture should stay roughly where it is.',
    });
  }

  if (dpDelta < -3) {
    return withDewPoints({
      score: 6,
      impact: 'mixed',
      title: 'Slightly drier outdoor air',
      body: 'Could freshen the air and nudge humidity down a touch — helpful if it felt stuffy, unnecessary if already comfortable.',
    });
  }

  return withDewPoints({
    score: -10,
    impact: 'mixed',
    title: 'Slightly moister outdoor air',
    body: 'You may add a bit of humidity indoors. Fine for a short airing, less ideal for long open windows.',
  });
}

function scoreCondensationRisk(indoorTempF, indoorRh, outdoorTempF, outdoorRh, unit) {
  const indoorDp = dewPointFahrenheit(indoorTempF, indoorRh);
  if (indoorDp === null) {
    return {
      score: 0,
      impact: 'neutral',
      title: 'Low condensation concern',
      body: 'Unable to assess moisture risk from the provided humidity reading.',
    };
  }

  // Window glass temperature tends to track outdoor air more than indoor air.
  const glassTempEstimate = outdoorTempF;
  const dewPointMargin = indoorDp - glassTempEstimate;

  if (dewPointMargin >= 10) {
    return {
      score: -35,
      impact: 'hurt',
      title: 'High condensation risk on windows',
      body: `Indoor dew point (${formatTemp(indoorDp, unit)}) is well above likely glass temperature (${formatTemp(glassTempEstimate, unit)}) — expect fogging and water on frames.`,
    };
  }

  if (dewPointMargin >= 5 && outdoorTempF < indoorTempF - 5) {
    return {
      score: -22,
      impact: 'mixed',
      title: 'Likely window condensation',
      body: 'Warm, moist indoor air hitting cold glass may bead up — crack windows rather than opening wide, or ventilate in short bursts.',
    };
  }

  if (dewPointMargin >= 2 && outdoorTempF < indoorTempF - 8) {
    return {
      score: -10,
      impact: 'mixed',
      title: 'Some condensation possible',
      body: 'A large warm-inside / cold-outside gap may fog glass at the edges even when ventilation otherwise helps.',
    };
  }

  return {
    score: 0,
    impact: 'neutral',
    title: 'Low condensation concern',
    body: 'Indoor moisture levels are unlikely to condense heavily on window glass at these temperatures.',
  };
}

function scoreSolarVentilationEffect(
  weather,
  indoorTempF,
  indoorRh,
  outdoorTempF,
  outdoorRh,
  needs,
  solarIntensity = 1,
) {
  if (weather !== 'clear' && weather !== 'partly-cloudy' && weather !== 'cloudy') {
    return null;
  }

  const finish = (factor) => {
    if (!factor) return null;
    if (solarIntensity <= 0.05) {
      return {
        score: 0,
        impact: 'neutral',
        title: 'Dark outside — no solar heating',
        body: 'The sun is down, so clear skies are not adding heat to the building right now.',
      };
    }
    if (weather === 'cloudy') return factor;
    return scaleSolarFactor(factor, solarIntensity);
  };

  const delta = outdoorTempF - indoorTempF;
  const absDelta = Math.abs(delta);
  const outdoorCooler = delta < -2;
  const outdoorWarmer = delta > 2;
  const needsCooling = needs.includes('cool');
  const maintainFreshAir =
    needs.includes('maintain') && outdoorCooler && !needsCooling;
  const sunny = weather === 'clear';
  const partlySunny = weather === 'partly-cloudy';
  const overcast = weather === 'cloudy';

  if (needs.includes('cool') && delta > 0) {
    const stickyAndDrier =
      needs.includes('dehumidify') &&
      isMuchDrierOutdoor(indoorTempF, indoorRh, outdoorTempF, outdoorRh);
    if (stickyAndDrier && delta <= 6) {
      return finish({
        score: -4,
        impact: 'mixed',
        title: 'Sun is a factor, but drier air helps',
        body: 'Sunny skies warm the home through windows, walls, and roof, but much drier outdoor air can still ease stuffiness — shade sun-facing windows if you ventilate.',
      });
    }
    return finish({
      score: sunny ? -10 : partlySunny ? -6 : -4,
      impact: 'mixed',
      title: 'Sun can warm the home',
      body: 'Sunny weather adds heat to the building while warmer outdoor air flows in — ventilation works against your cooling goal.',
    });
  }

  if (maintainFreshAir) {
    if (overcast && absDelta >= 3) {
      return finish({
        score: absDelta >= 8 ? 5 : 3,
        impact: 'help',
        title: 'Overcast and cool — great for fresh air',
        body: 'You\'re already comfortable. Cool, overcast outdoor air should freshen the home without overshooting your range.',
      });
    }

    if (absDelta >= 12) {
      return finish({
        score: sunny ? 3 : 4,
        impact: 'help',
        title: sunny ? 'Cool outdoor air — good for fresh air' : 'Cool outdoor air helps',
        body: 'You\'re already comfortable. Much cooler outdoor air should freshen the home; sun may soften the effect, but you are unlikely to overshoot your range.',
      });
    }

    if (absDelta >= 7) {
      return finish({
        score: sunny ? 2 : partlySunny ? 3 : 4,
        impact: 'help',
        title: sunny ? 'Cool outdoor air — good time to freshen up' : 'Cool outdoor air helps',
        body: 'You\'re already comfortable. Cooler outdoor air should freshen the home and nudge temps down a bit — sunny weather may soften the effect, but you should stay in your comfort range.',
      });
    }

    if (absDelta >= 3) {
      return finish({
        score: sunny ? 1 : 2,
        impact: 'help',
        title: 'Cool outdoor air helps freshness',
        body: 'You\'re already comfortable. Modestly cooler outdoor air is fine for a short airing; sunny weather limits how much temps will shift.',
      });
    }

    return finish({
      score: 0,
      impact: 'neutral',
      title: 'Little temperature change expected',
      body: 'Indoor and outdoor temps are close — ventilation is mainly for air freshness.',
    });
  }

  if (needsCooling && outdoorCooler) {
    if (overcast && absDelta >= 3) {
      return finish({
        score: absDelta >= 8 ? 4 : 2,
        impact: 'help',
        title: 'Overcast skies reduce solar heating',
        body: 'Cloud cover reduces solar heating on the building, so cool outdoor air can do more of the work.',
      });
    }

    if (absDelta >= 12) {
      return finish({
        score: sunny ? 0 : 2,
        impact: sunny ? 'mixed' : 'help',
        title: sunny ? 'Strong cool air, but sun is still a factor' : 'Cool air with mild solar gain',
        body: sunny
          ? 'Outdoor air is much cooler than inside, so ventilation should still help — but sunlight warming the home will offset some of the gain.'
          : 'Cool outdoor air can pull heat out with less solar heating on the building.',
      });
    }

    if (absDelta >= 7) {
      return finish({
        score: sunny ? -3 : partlySunny ? -1 : 1,
        impact: 'mixed',
        title: sunny ? 'Sun competes with modest cooling' : 'Partly sunny — cooling may be uneven',
        body: 'Cool outdoor air helps, but sunny weather keeps adding heat to the home and can cancel much of the temperature drop.',
      });
    }

    if (absDelta >= 3) {
      return finish({
        score: sunny ? -6 : partlySunny ? -4 : 0,
        impact: 'mixed',
        title: sunny ? 'Sunny day limits net cooling' : 'Expect limited temperature change',
        body: 'Outdoor air is only modestly cooler; in sunny weather the building keeps gaining heat, so net cooling is often small — openings mainly freshen the air.',
      });
    }

    return finish({
      score: sunny ? -4 : -2,
      impact: 'mixed',
      title: 'Little temperature change expected',
      body: 'Indoor and outdoor temps are close; sunny weather makes meaningful cooling unlikely.',
    });
  }

  if (needs.includes('maintain') && outdoorWarmer) {
    return finish({
      score: sunny ? -6 : partlySunny ? -3 : 0,
      impact: sunny ? 'mixed' : 'neutral',
      title: sunny ? 'Sun and warm outdoor air' : 'Warm outdoor air',
      body: sunny
        ? 'Sunny weather heats the building while warmer outdoor air flows in — an already-comfortable home may slowly feel warmer.'
        : 'Warmer outdoor air may nudge an already-comfortable room warmer over time.',
    });
  }

  if (needs.includes('maintain') && absDelta <= 2) {
    return finish({
      score: 0,
      impact: 'neutral',
      title: sunny ? 'Clear weather — solar heating on the building' : 'Mild weather impact',
      body: 'Sunlight warms the home through windows and exterior surfaces; at these temps ventilation is mainly for air freshness.',
    });
  }

  return null;
}

function scoreWeather(
  weather,
  indoorTempF,
  indoorRh,
  outdoorTempF,
  outdoorRh,
  needs,
  solarIntensity = 1,
  comfortMinF = COMFORT_DEFAULT_MIN_F,
  comfortMaxF = COMFORT_DEFAULT_MAX_F,
) {
  const { tempLowF } = normalizeComfortBounds(comfortMinF, comfortMaxF);

  switch (weather) {
    case 'rainy': {
      const indoorDp = dewPointFahrenheit(indoorTempF, indoorRh);
      const outdoorDp = dewPointFahrenheit(outdoorTempF, outdoorRh);
      const outdoorIsDrier =
        indoorDp !== null && outdoorDp !== null && outdoorDp < indoorDp - 3;

      if (needs.includes('dehumidify') && outdoorIsDrier) {
        return {
          score: -5,
          impact: 'mixed',
          title: 'Rain is awkward, but outdoor air looks drier',
          body: 'Keep openings small and watch sills — outdoor dew point is lower than inside even though it is raining.',
        };
      }

      return {
        score: needs.includes('dehumidify') ? -20 : -8,
        impact: needs.includes('dehumidify') ? 'hurt' : 'mixed',
        title: 'Rain usually means wetter air',
        body: needs.includes('dehumidify')
          ? 'Rain and post-storm air often carry extra moisture — poor timing if you need to dry the home.'
          : 'Keep openings smaller and watch sills; rain raises humidity and can blow in water.',
      };
    }
    case 'windy': {
      const delta = outdoorTempF - indoorTempF;
      const shiftF = estimateVentilationTempShiftF(indoorTempF, outdoorTempF);
      const estIndoorF = indoorTempF + shiftF;
      const unfavorable =
        (needs.includes('cool') &&
          delta > 2 &&
          !(needs.includes('dehumidify') &&
            isMuchDrierOutdoor(indoorTempF, indoorRh, outdoorTempF, outdoorRh))) ||
        (needs.includes('warm') && delta < -5) ||
        (needs.includes('maintain') && delta > 8) ||
        (needs.includes('maintain') &&
          delta < -8 &&
          estIndoorF < tempLowF - 1.5) ||
        (needs.includes('dehumidify') &&
          !needs.includes('cool') &&
          delta < -15 &&
          !isMuchDrierOutdoor(indoorTempF, indoorRh, outdoorTempF, outdoorRh, 5));

      if (unfavorable) {
        return {
          score: -6,
          impact: 'mixed',
          title: 'Wind accelerates unwanted exchange',
          body: 'A strong breeze pulls outdoor air in faster — amplifying the temperature or moisture mismatch.',
        };
      }

      if (needs.includes('maintain') && Math.abs(delta) >= 3 && Math.abs(delta) < 8) {
        return {
          score: 3,
          impact: 'neutral',
          title: 'Breeze helps air exchange',
          body: 'Wind moves air faster, but the modest indoor/outdoor gap still limits how much temperature or humidity will shift.',
        };
      }

      return {
        score: 8,
        impact: 'help',
        title: 'Breeze improves air exchange',
        body: 'Wind helps flush stale indoor air faster, so favorable outdoor conditions do more work in less time.',
      };
    }
    case 'clear':
    case 'partly-cloudy':
    case 'cloudy': {
      const solarEffect = scoreSolarVentilationEffect(
        weather,
        indoorTempF,
        indoorRh,
        outdoorTempF,
        outdoorRh,
        needs,
        solarIntensity,
      );
      if (solarEffect) return solarEffect;
      return {
        score: 0,
        impact: 'neutral',
        title: 'Weather has little effect',
        body: 'Outdoor air temperature matters more than sky conditions for this scenario.',
      };
    }
    default:
      return {
        score: 0,
        impact: 'neutral',
        title: 'Weather has little effect',
        body: 'Outdoor air temperature matters more than sky conditions for this scenario.',
      };
  }
}

function pickVerdict(totalScore) {
  if (totalScore >= 45) return VERDICTS.strongGood;
  if (totalScore >= 22) return VERDICTS.good;
  if (totalScore >= 8) return VERDICTS.marginal;
  if (totalScore >= -7) return VERDICTS.notWorthIt;
  if (totalScore >= -25) return VERDICTS.likelyWorse;
  return VERDICTS.avoid;
}

function buildHeadline(verdict, needs) {
  const goals = [];
  if (needs.includes('cool')) goals.push('cool down');
  if (needs.includes('warm')) goals.push('warm up');
  if (needs.includes('dehumidify')) goals.push('dry out');
  if (needs.includes('humidify')) goals.push('add moisture');
  const primary = goals.length > 0 ? goals.join(' and ') : 'refresh the air';

  switch (verdict.level) {
    case 'strong-good':
      return `Opening windows should noticeably help you ${primary}`;
    case 'good':
      return `Opening windows is likely worthwhile to ${primary}`;
    case 'marginal':
      return `Opening windows may help a little — but expect modest gains`;
    case 'not-worth-it':
      return `Probably not worth opening wide right now`;
    case 'likely-worse':
      return `Opening windows will likely make things slightly worse`;
    case 'avoid':
      return `Keep windows closed for now`;
    default:
      return 'Evaluate your conditions';
  }
}

function buildSummary(verdict, tempFactor, humidityFactor, condensationFactor, weatherFactor) {
  const parts = [];

  if (tempFactor.impact === 'help') parts.push('temperature looks favorable');
  else if (tempFactor.impact === 'hurt') parts.push('temperature works against you');
  else if (tempFactor.impact === 'mixed') parts.push('temperature effects are mixed');

  if (humidityFactor.impact === 'help') parts.push('humidity should improve');
  else if (humidityFactor.impact === 'hurt') parts.push('humidity may worsen');
  else if (humidityFactor.impact === 'mixed') parts.push('humidity change will be small');

  if (condensationFactor.impact === 'hurt') parts.push('condensation risk is significant');
  else if (condensationFactor.impact === 'mixed') parts.push('some window condensation is possible');

  if (weatherFactor.impact === 'help') parts.push('weather supports ventilation');
  else if (weatherFactor.impact === 'hurt') parts.push('weather adds downside');
  else if (weatherFactor.impact === 'mixed') parts.push('weather is a minor factor');

  const joined =
    parts.length === 0
      ? 'Conditions are roughly neutral.'
      : `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? `, and ${parts.slice(1).join(', ')}` : ''}.`;

  if (verdict.level === 'marginal' || verdict.level === 'not-worth-it') {
    return `${joined} The improvement may be small — try a short airing if you mainly want fresher air.`;
  }

  if (verdict.level === 'likely-worse' || verdict.level === 'avoid') {
    return `${joined} Waiting for better outdoor conditions is the safer bet.`;
  }

  return `${joined} Natural ventilation should move indoor conditions in a helpful direction.`;
}

function evaluateConditions({
  indoorTempF,
  outdoorTempF,
  indoorRh,
  outdoorRh,
  weather,
  unit = 'f',
  comfortMinF = COMFORT_DEFAULT_MIN_F,
  comfortMaxF = COMFORT_DEFAULT_MAX_F,
  latitudeDeg = DEFAULT_LATITUDE_DEG,
  localDate = null,
  localTimeMinutes = null,
}) {
  const comfortBand = normalizeComfortBounds(comfortMinF, comfortMaxF);
  const solarIntensity = resolveSolarIntensity(latitudeDeg, localDate, localTimeMinutes);
  const needs = inferIndoorNeeds(
    indoorTempF,
    indoorRh,
    comfortBand.tempLowF,
    comfortBand.tempHighF,
  );
  const tempFactor = scoreTemperature(
    indoorTempF,
    outdoorTempF,
    needs,
    unit,
    indoorRh,
    outdoorRh,
    comfortBand.tempLowF,
    comfortBand.tempHighF,
  );
  const humidityFactor = scoreHumidity(
    indoorTempF,
    indoorRh,
    outdoorTempF,
    outdoorRh,
    needs,
  );
  const condensationFactor = scoreCondensationRisk(
    indoorTempF,
    indoorRh,
    outdoorTempF,
    outdoorRh,
    unit,
  );
  const weatherFactor = scoreWeather(
    weather,
    indoorTempF,
    indoorRh,
    outdoorTempF,
    outdoorRh,
    needs,
    solarIntensity,
    comfortBand.tempLowF,
    comfortBand.tempHighF,
  );

  const totalScore =
    tempFactor.score +
    humidityFactor.score +
    condensationFactor.score +
    weatherFactor.score;

  const verdict = pickVerdict(totalScore);
  const ventilationShiftF = estimateVentilationTempShiftF(indoorTempF, outdoorTempF);

  return {
    needs,
    verdict,
    totalScore,
    comfortBand,
    ventilationShiftF,
    estimatedIndoorF: indoorTempF + ventilationShiftF,
    solarIntensity,
    tempFactor,
    humidityFactor,
    condensationFactor,
    weatherFactor,
  };
}

function renderMetric(label, value) {
  const el = document.createElement('div');
  el.className = 'metric';
  el.innerHTML = `<span class="metric__label">${label}</span><span class="metric__value">${value}</span>`;
  return el;
}

function renderFactor(factor) {
  const icons = {
    help: '✓',
    hurt: '✕',
    mixed: '~',
    neutral: '•',
  };

  const li = document.createElement('li');
  li.className = `factor factor--${factor.impact}`;
  li.innerHTML = `
    <span class="factor__icon" aria-hidden="true">${icons[factor.impact] || '•'}</span>
    <div>
      <p class="factor__title">${factor.title}</p>
      <p class="factor__body">${factor.body}</p>
    </div>
  `;
  return li;
}

function clearResults() {
  elements.resultsPlaceholder.hidden = false;
  elements.results.hidden = true;
  elements.verdictBadge.textContent = '';
  elements.verdictHeadline.textContent = '';
  elements.verdictSummary.textContent = '';
  elements.metrics.replaceChildren();
  elements.factors.replaceChildren();
  showValidation('');
}

function parseLocalTimeMinutes(timeValue) {
  if (typeof timeValue !== 'string' || !timeValue) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getSolarInputs() {
  const latitudeDeg = Number(elements.latitude?.value ?? DEFAULT_LATITUDE_DEG);
  const localDate = elements.localDate?.value || null;
  const localTimeMinutes = parseLocalTimeMinutes(elements.localTime?.value);
  return {
    latitudeDeg: Number.isFinite(latitudeDeg) ? latitudeDeg : DEFAULT_LATITUDE_DEG,
    localDate,
    localTimeMinutes,
  };
}

function initSunlightInputs() {
  if (!elements.localDate || !elements.localTime) return;

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  elements.localDate.value = `${yyyy}-${mm}-${dd}`;

  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  elements.localTime.value = `${hh}:${min}`;

  if (elements.latitude && !elements.latitude.value) {
    elements.latitude.value = String(DEFAULT_LATITUDE_DEG);
  }

  updateSunlightHint();
}

function updateSunlightHint() {
  if (!elements.sunlightHint) return;
  const { latitudeDeg, localDate } = getSolarInputs();
  elements.sunlightHint.textContent = describeSunlightWindow(latitudeDeg, localDate);
}

function evaluate() {
  const unit = getUnit();
  const indoorTempF = toFahrenheit(Number(elements.indoorTemp.value), unit);
  const outdoorTempF = toFahrenheit(Number(elements.outdoorTemp.value), unit);
  const indoorRh = Number(elements.indoorHumidity.value);
  const outdoorRh = Number(elements.outdoorHumidity.value);

  if (
    [indoorTempF, outdoorTempF, indoorRh, outdoorRh].some(
      (value) => Number.isNaN(value) || !Number.isFinite(value),
    )
  ) {
    showValidation('Please enter valid numbers for all temperature and humidity fields.');
    return;
  }

  if (indoorRh < 0 || indoorRh > 100 || outdoorRh < 0 || outdoorRh > 100) {
    showValidation('Humidity must be between 0 and 100%.');
    return;
  }

  const { latitudeDeg, localDate, localTimeMinutes } = getSolarInputs();
  if (latitudeDeg < -60 || latitudeDeg > 70) {
    showValidation('Latitude must be between -60 and 70.');
    return;
  }

  showValidation('');

  const { tempLowF: comfortMinF, tempHighF: comfortMaxF } = getComfortBoundsF();

  const result = evaluateConditions({
    indoorTempF,
    outdoorTempF,
    indoorRh,
    outdoorRh,
    weather: elements.weather.value,
    unit,
    comfortMinF,
    comfortMaxF,
    latitudeDeg,
    localDate,
    localTimeMinutes,
  });

  const {
    needs,
    verdict,
    comfortBand,
    ventilationShiftF,
    tempFactor,
    humidityFactor,
    condensationFactor,
    weatherFactor,
  } = result;

  elements.resultsPlaceholder.hidden = true;
  elements.results.hidden = false;

  elements.verdict.className = `verdict ${verdict.cssClass}`;
  elements.verdictBadge.textContent = verdict.badge;
  elements.verdictHeadline.textContent = buildHeadline(verdict, needs);
  elements.verdictSummary.textContent = buildSummary(
    verdict,
    tempFactor,
    humidityFactor,
    condensationFactor,
    weatherFactor,
  );

  elements.metrics.replaceChildren(
    renderMetric('Temp difference', formatTempDifference(outdoorTempF, indoorTempF, unit)),
    renderMetric('Expected shift', formatVentilationShift(ventilationShiftF, unit)),
    renderMetric(
      'Moisture difference',
      formatDewPointDifference(humidityFactor.outdoorDp, humidityFactor.indoorDp, unit),
    ),
    renderMetric('Indoor dew point', formatTemp(humidityFactor.indoorDp, unit)),
    renderMetric(
      'Comfort range',
      formatComfortRange(comfortBand.tempLowF, comfortBand.tempHighF, unit),
    ),
    renderMetric(
      'Solar heating',
      formatSolarHeatingMetric(
        result.solarIntensity * weatherSolarMultiplier(elements.weather.value),
        result.solarIntensity,
        elements.weather.value,
      ),
    ),
    renderMetric('Goals', describeNeeds(needs)),
  );

  elements.factors.replaceChildren(
    renderFactor(tempFactor),
    renderFactor(humidityFactor),
    renderFactor(condensationFactor),
    renderFactor(weatherFactor),
  );
}

function getComfortSliderRange(unit) {
  if (unit === 'c') return { min: 16, max: 27, step: 1 };
  return { min: 60, max: 80, step: 1 };
}

function readComfortSliderF(slider, unit, fallbackF) {
  if (!slider) return fallbackF;
  const value = Number(slider.value);
  if (Number.isNaN(value)) return fallbackF;
  return toFahrenheit(value, unit);
}

function getComfortBoundsF() {
  const unit = getUnit();
  const range = getComfortSliderRange(unit);
  const defaultMinF = toFahrenheit(range.min + 3, unit);
  const defaultMaxF = toFahrenheit(range.min + 9, unit);
  const comfortMinF = readComfortSliderF(elements.comfortMin, unit, defaultMinF);
  const comfortMaxF = readComfortSliderF(elements.comfortMax, unit, defaultMaxF);
  return normalizeComfortBounds(comfortMinF, comfortMaxF);
}

function enforceComfortSliderOrder(changed) {
  if (!elements.comfortMin || !elements.comfortMax) return;

  const unit = getUnit();
  const range = getComfortSliderRange(unit);
  const minSpan = unit === 'c' ? 1 : COMFORT_MIN_SPAN_F;
  let minVal = Number(elements.comfortMin.value);
  let maxVal = Number(elements.comfortMax.value);

  if (Number.isNaN(minVal)) minVal = range.min + 3;
  if (Number.isNaN(maxVal)) maxVal = range.min + 9;

  if (changed === 'min' && minVal > maxVal - minSpan) {
    maxVal = Math.min(range.max, minVal + minSpan);
    elements.comfortMax.value = String(maxVal);
  }
  else if (changed === 'max' && maxVal < minVal + minSpan) {
    minVal = Math.max(range.min, maxVal - minSpan);
    elements.comfortMin.value = String(minVal);
  }
}

function updateComfortDisplay() {
  if (!elements.comfortMin || !elements.comfortMax || !elements.comfortRangeDisplay) return;
  const unit = getUnit();
  const { tempLowF, tempHighF } = getComfortBoundsF();
  elements.comfortRangeDisplay.textContent = formatComfortRange(tempLowF, tempHighF, unit);
  if (elements.comfortRangeHint) {
    elements.comfortRangeHint.textContent =
      'Recommendations assume you want to stay within this range.';
  }
}

function syncComfortSlidersToUnit(fromUnit, toUnit) {
  if (!elements.comfortMin || !elements.comfortMax) return;

  const minAsF = toFahrenheit(Number(elements.comfortMin.value), fromUnit);
  const maxAsF = toFahrenheit(Number(elements.comfortMax.value), fromUnit);
  const range = getComfortSliderRange(toUnit);

  elements.comfortMin.min = String(range.min);
  elements.comfortMin.max = String(range.max);
  elements.comfortMin.step = String(range.step);
  elements.comfortMax.min = String(range.min);
  elements.comfortMax.max = String(range.max);
  elements.comfortMax.step = String(range.step);

  elements.comfortMin.value = String(Math.round(fromFahrenheit(minAsF, toUnit)));
  elements.comfortMax.value = String(Math.round(fromFahrenheit(maxAsF, toUnit)));
  enforceComfortSliderOrder('min');
  updateComfortDisplay();
}

function initComfortSliders() {
  if (!elements.comfortMin || !elements.comfortMax) return;
  const unit = getUnit();
  const range = getComfortSliderRange(unit);
  elements.comfortMin.min = String(range.min);
  elements.comfortMin.max = String(range.max);
  elements.comfortMin.step = String(range.step);
  elements.comfortMax.min = String(range.min);
  elements.comfortMax.max = String(range.max);
  elements.comfortMax.step = String(range.step);
  updateComfortDisplay();
}

function getFormState() {
  const { tempLowF, tempHighF } = getComfortBoundsF();
  return {
    unit: getUnit(),
    indoorTemp: elements.indoorTemp.value,
    indoorHumidity: elements.indoorHumidity.value,
    outdoorTemp: elements.outdoorTemp.value,
    outdoorHumidity: elements.outdoorHumidity.value,
    weather: elements.weather.value,
    comfortMinF: tempLowF,
    comfortMaxF: tempHighF,
    latitudeDeg: Number(elements.latitude?.value) || DEFAULT_LATITUDE_DEG,
  };
}

function saveFormState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getFormState()));
  }
  catch {
    // Storage unavailable or full — ignore.
  }
}

function loadFormState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object') return;

    if (state.unit === 'f' || state.unit === 'c') {
      elements.unitInputs.forEach((input) => {
        input.checked = input.value === state.unit;
      });
    }

    if (!isNullish(state.indoorTemp)) elements.indoorTemp.value = String(state.indoorTemp);
    if (!isNullish(state.indoorHumidity)) elements.indoorHumidity.value = String(state.indoorHumidity);
    if (!isNullish(state.outdoorTemp)) elements.outdoorTemp.value = String(state.outdoorTemp);
    if (!isNullish(state.outdoorHumidity)) {
      elements.outdoorHumidity.value = String(state.outdoorHumidity);
    }

    if (typeof state.weather === 'string' && WEATHER_OPTIONS.has(state.weather)) {
      elements.weather.value = state.weather;
    }

    if (typeof state.latitudeDeg === 'number' && Number.isFinite(state.latitudeDeg)) {
      elements.latitude.value = String(state.latitudeDeg);
    }

    if (typeof state.comfortMinF === 'number' && typeof state.comfortMaxF === 'number') {
      if (elements.comfortMin) {
        elements.comfortMin.value = String(
          Math.round(fromFahrenheit(state.comfortMinF, getUnit())),
        );
      }
      if (elements.comfortMax) {
        elements.comfortMax.value = String(
          Math.round(fromFahrenheit(state.comfortMaxF, getUnit())),
        );
      }
    }
    else if (typeof state.comfortTargetF === 'number') {
      const legacy = comfortBoundsFromLegacyTarget(state.comfortTargetF);
      if (elements.comfortMin) {
        elements.comfortMin.value = String(
          Math.round(fromFahrenheit(legacy.tempLowF, getUnit())),
        );
      }
      if (elements.comfortMax) {
        elements.comfortMax.value = String(
          Math.round(fromFahrenheit(legacy.tempHighF, getUnit())),
        );
      }
    }
  }
  catch {
    // Corrupt or unreadable saved data — keep HTML defaults.
  }
}

function onInputChange() {
  clearResults();
  saveFormState();
}

function updateUnitLabels() {
  const symbol = getUnit() === 'c' ? '°C' : '°F';
  elements.unitLabels.forEach((label) => {
    label.textContent = symbol;
  });
}

function convertInputValues(fromUnit, toUnit) {
  if (fromUnit === toUnit) return;

  const fields = [elements.indoorTemp, elements.outdoorTemp];
  fields.forEach((field) => {
    const current = Number(field.value);
    if (Number.isNaN(current)) return;
    const asF = toFahrenheit(current, fromUnit);
    const converted = fromFahrenheit(asF, toUnit);
    field.value = String(Math.round(converted * 10) / 10);
  });
}

elements.unitInputs.forEach((input) => {
  input.addEventListener('change', () => {
    const newUnit = getUnit();
    const previousUnit = newUnit === 'c' ? 'f' : 'c';
    convertInputValues(previousUnit, newUnit);
    syncComfortSlidersToUnit(previousUnit, newUnit);
    updateUnitLabels();
    onInputChange();
  });
});

elements.evaluateBtn.addEventListener('click', evaluate);

function onComfortSliderInput(changed) {
  enforceComfortSliderOrder(changed);
  updateComfortDisplay();
  onInputChange();
}

if (elements.comfortMin) {
  elements.comfortMin.addEventListener('input', () => onComfortSliderInput('min'));
}

if (elements.comfortMax) {
  elements.comfortMax.addEventListener('input', () => onComfortSliderInput('max'));
}

const inputElements = [
  elements.indoorTemp,
  elements.indoorHumidity,
  elements.outdoorTemp,
  elements.outdoorHumidity,
  elements.weather,
  elements.localDate,
  elements.localTime,
  elements.latitude,
];

inputElements.forEach((el) => {
  if (!el) return;
  const refreshSunlightHint =
    el === elements.localDate || el === elements.latitude;
  el.addEventListener('input', () => {
    if (refreshSunlightHint) updateSunlightHint();
    onInputChange();
  });
  el.addEventListener('change', () => {
    if (refreshSunlightHint) updateSunlightHint();
    onInputChange();
  });
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') evaluate();
  });
});

loadFormState();
initSunlightInputs();
initComfortSliders();
updateUnitLabels();
