const COMFORT = {
  rhLow: 30,
  /** Target ceiling -- above this feels stuffy/muggy even when temperature is fine. */
  rhTargetMax: 50,
  /** Legacy alias used in comparisons. */
  rhIdealHigh: 50,
  rhHigh: 50,
};

const COMFORT_DEFAULT_MIN_F = 68;
const COMFORT_DEFAULT_MAX_F = 78;
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

/** Whole-home average rarely shifts more than this °F from window ventilation alone. */
const VENTILATION_MAX_SHIFT_F = 18;
/** Typical occupied-home heat (people, pets, appliances) added to expected shift when HVAC is off. */
const INTERNAL_GAIN_SHIFT_F = 1.25;

const HOME_TYPES = new Set(['detached', 'row-twin', 'apartment']);
const STORY_COUNTS = new Set(['1', '2', '3']);
const WINDOW_OPENINGS = new Set(['cracked-few', 'moderate-some', 'wide-open']);
const FLOORS_OPEN = new Set(['one-floor', 'two-floors', 'all-floors']);
const SUN_EXPOSURES = new Set(['mostly-shaded', 'mixed', 'full-sun']);
const TEMP_MEASUREMENT_FLOORS = new Set(['basement', 'main', 'upper']);

const DEFAULT_HOME_PROFILE = {
  homeType: 'detached',
  storyCount: '2',
  windowOpening: 'moderate-some',
  floorsOpen: 'one-floor',
  sunExposure: 'mixed',
  tempMeasurementFloor: 'main',
};

function normalizeHomeProfile(profile = {}) {
  const storyCount = STORY_COUNTS.has(String(profile.storyCount))
    ? String(profile.storyCount)
    : DEFAULT_HOME_PROFILE.storyCount;
  const floorsOpen = normalizeFloorsOpen(profile.floorsOpen, storyCount);

  return {
    homeType: HOME_TYPES.has(profile.homeType) ? profile.homeType : DEFAULT_HOME_PROFILE.homeType,
    storyCount,
    windowOpening: WINDOW_OPENINGS.has(profile.windowOpening)
      ? profile.windowOpening
      : DEFAULT_HOME_PROFILE.windowOpening,
    floorsOpen,
    sunExposure: SUN_EXPOSURES.has(profile.sunExposure)
      ? profile.sunExposure
      : DEFAULT_HOME_PROFILE.sunExposure,
    tempMeasurementFloor: TEMP_MEASUREMENT_FLOORS.has(profile.tempMeasurementFloor)
      ? profile.tempMeasurementFloor
      : DEFAULT_HOME_PROFILE.tempMeasurementFloor,
  };
}

function normalizeFloorsOpen(floorsOpen, storyCount) {
  const stories = Number(storyCount) || 2;
  if (stories <= 1) return 'one-floor';
  if (stories === 2 && floorsOpen === 'all-floors') return 'two-floors';
  if (FLOORS_OPEN.has(floorsOpen)) return floorsOpen;
  return DEFAULT_HOME_PROFILE.floorsOpen;
}

function windowOpeningFactor(windowOpening) {
  switch (windowOpening) {
    case 'cracked-few':
      return 0.22;
    case 'moderate-some':
      return 0.55;
    case 'wide-open':
      return 1;
    default:
      return 0.55;
  }
}

function floorsOpenCount(floorsOpen, storyCount) {
  const stories = Number(storyCount) || 2;
  switch (floorsOpen) {
    case 'one-floor':
      return 1;
    case 'two-floors':
      return Math.min(2, stories);
    case 'all-floors':
      return stories;
    default:
      return 1;
  }
}

function floorsOpenFactor(floorsOpen, storyCount) {
  const stories = Number(storyCount) || 2;
  const openCount = floorsOpenCount(floorsOpen, storyCount);
  const ratio = Math.min(openCount / stories, 1);
  return 0.18 + 0.82 * ratio ** 0.85;
}

function homeTypeFactor(homeType) {
  switch (homeType) {
    case 'detached':
      return 1;
    case 'row-twin':
      return 0.85;
    case 'apartment':
      return 0.62;
    default:
      return 1;
  }
}

function sunExposureMultiplier(sunExposure) {
  switch (sunExposure) {
    case 'mostly-shaded':
      return 0.5;
    case 'mixed':
      return 0.8;
    case 'full-sun':
      return 1.15;
    default:
      return 0.8;
  }
}

function measurementFloorAdjustment(tempMeasurementFloor, storyCount) {
  const stories = Number(storyCount) || 2;
  switch (tempMeasurementFloor) {
    case 'basement':
      return {
        ventilationScale: stories >= 3 ? 0.3 : 0.45,
        solarScale: 0.85,
      };
    case 'upper':
      return {
        ventilationScale: 0.62,
        solarScale: 1.12,
      };
    case 'main':
    default:
      return {
        ventilationScale: 1,
        solarScale: 1,
      };
  }
}

function computeShiftAtMeasurementFloor({
  indoorTempF,
  idealVentilationShiftF,
  baseSolarHeatingShiftF,
  internalGainShiftF,
  ventilationEffectiveness,
  sunExposure,
  tempMeasurementFloor,
  storyCount,
}) {
  const floorAdj = measurementFloorAdjustment(tempMeasurementFloor, storyCount);
  const sunMult = sunExposureMultiplier(sunExposure);
  const ventilationShiftF =
    idealVentilationShiftF * ventilationEffectiveness * floorAdj.ventilationScale;
  const solarHeatingShiftF = baseSolarHeatingShiftF * sunMult * floorAdj.solarScale;
  const expectedShiftF = ventilationShiftF + solarHeatingShiftF + internalGainShiftF;

  return {
    ventilationShiftF,
    solarHeatingShiftF,
    internalGainShiftF,
    expectedShiftF,
    estimatedIndoorF: indoorTempF + expectedShiftF,
  };
}

function describeTempMeasurementFloor(floor) {
  switch (floor) {
    case 'basement':
      return 'basement';
    case 'upper':
      return 'upper floor';
    case 'main':
    default:
      return 'main floor';
  }
}

function describeVentilationSetup(profile) {
  const opening =
    profile.windowOpening === 'cracked-few'
      ? 'cracked / few windows'
      : profile.windowOpening === 'wide-open'
        ? 'wide-open windows'
        : 'moderately open windows';
  const stories = Number(profile.storyCount) || 2;
  const openCount = floorsOpenCount(profile.floorsOpen, profile.storyCount);
  const floorPart =
    openCount >= stories
      ? `all ${stories} floor${stories === 1 ? '' : 's'}`
      : `${openCount} of ${stories} floor${stories === 1 ? '' : 's'}`;
  return `${opening}, ${floorPart}`;
}

function buildCoolingOutlook({
  verdict,
  needs,
  idealExpectedShiftF,
  expectedShiftF,
  ventilationEffectiveness,
  homeProfile,
  unit,
}) {
  const floorLabel = describeTempMeasurementFloor(homeProfile.tempMeasurementFloor);
  const setup = describeVentilationSetup(homeProfile);
  const idealText = formatExpectedShiftDisplay(idealExpectedShiftF, unit);
  const adjustedText = formatExpectedShiftDisplay(expectedShiftF, unit);
  const limitedSetup = ventilationEffectiveness < 0.45;
  const negligibleShift = Math.abs(expectedShiftF) < 0.75;
  const wantsCool = needs.includes('cool');
  const wantsDry = needs.includes('dehumidify');

  if (negligibleShift) {
    if (limitedSetup && (wantsCool || wantsDry)) {
      return `At the ${floorLabel} (${setup}), expect ${adjustedText} -- little thermostat movement even if outdoor air would help freshen or dry the home. Ideal mixing alone would be ${idealText}.`;
    }
    if (limitedSetup) {
      return `At the ${floorLabel} (${setup}), expect ${adjustedText}. With limited window opening, whole-home temps often change slowly and unevenly by floor.`;
    }
    return `At the ${floorLabel}, expect ${adjustedText} if windows stay open long enough.`;
  }

  if (limitedSetup && Math.abs(idealExpectedShiftF) > Math.abs(expectedShiftF) + 1) {
    return `At the ${floorLabel} (${setup}), expect ${adjustedText}. Outdoor air could do more with wider or cross-floor ventilation (ideal mixing: ${idealText}).`;
  }

  if (verdict.level === 'good' || verdict.level === 'strong-good') {
    if (wantsCool && expectedShiftF > -0.5) {
      return `Worth opening for air quality, but at the ${floorLabel} (${setup}) cooling may stay modest -- about ${adjustedText}.`;
    }
    return `At the ${floorLabel} (${setup}), expect about ${adjustedText} if ventilation continues.`;
  }

  return `At the ${floorLabel} (${setup}), expect about ${adjustedText}.`;
}

function buildHumidityOutlook({
  needs,
  humidityFactor,
  ventilationEffectiveness,
  indoorRh,
  indoorTempF,
  outdoorTempF,
  outdoorRh,
  homeProfile,
}) {
  const indoorDp = dewPointFahrenheit(indoorTempF, indoorRh);
  const outdoorDp = dewPointFahrenheit(outdoorTempF, outdoorRh);
  const dpDelta =
    indoorDp === null || outdoorDp === null ? 0 : outdoorDp - indoorDp;
  const setup = describeVentilationSetup(homeProfile);
  const effectiveness = Number.isFinite(ventilationEffectiveness)
    ? ventilationEffectiveness
    : 1;
  const limited = effectiveness < 0.45;
  const moderate = effectiveness >= 0.45 && effectiveness < 0.7;
  const pace = limited ? 'slow' : moderate ? 'gradual' : 'noticeable';

  if (needs.includes('dehumidify')) {
    if (dpDelta <= -8) {
      if (humidityFactor.impact === 'help' || humidityFactor.score > 0) {
        if (limited) {
          return `Outdoor air is much drier, but with ${setup} drying at your floor will be slow — don't expect RH to drop quickly.`;
        }
        if (moderate) {
          return `Good drying potential outdoors — expect gradual humidity relief over an hour or two with ${setup}.`;
        }
        return `Good drying potential — outdoor air is much drier; humidity should move toward outdoor levels with ${setup}.`;
      }
    }
    if (dpDelta <= -1 && humidityFactor.score > 0) {
      if (limited) {
        return `Outdoor air is somewhat drier, but ${setup} limits how fast humidity will change — modest relief at best.`;
      }
      return `Modest drying potential — expect ${pace} humidity improvement with ${setup}.`;
    }
    if (dpDelta >= 3 || humidityFactor.impact === 'hurt') {
      return `Outdoor air is moister than inside — ventilation may increase humidity${limited ? ', even slowly' : ''}.`;
    }
    if (Math.abs(dpDelta) <= 2) {
      return 'Indoor and outdoor moisture are similar — ventilation alone will not change humidity much.';
    }
    if (indoorRh > COMFORT.rhTargetMax && limited) {
      return `At ${Math.round(indoorRh)}% RH with ${setup}, ventilation may freshen air but drying will be slow unless outdoor dew point is much lower.`;
    }
  }

  if (needs.includes('humidify')) {
    if (humidityFactor.impact === 'help') {
      return limited
        ? `Outdoor air is somewhat moister, but ${setup} makes adding humidity a slow process.`
        : 'Outdoor air carries more moisture — expect gradual humidifying with open windows.';
    }
    if (humidityFactor.impact === 'hurt') {
      return 'Outdoor air is drier than inside — ventilation will pull humidity down, not up.';
    }
  }

  if (dpDelta <= -5 && effectiveness >= 0.5 && humidityFactor.score >= 0) {
    return `Slightly drier outdoor air — may nudge humidity down ${pace}ly if windows stay open.`;
  }

  return '';
}

const DEFAULT_LATITUDE_DEG = 41.879539;
const DEFAULT_LONGITUDE_DEG = -87.624039;
const TWILIGHT_MINUTES = 30;

function normalizeMinutesOfDay(minutes) {
  return ((minutes % 1440) + 1440) % 1440;
}

/** Hours from UTC for local civil time (negative west of Greenwich). */
function getLocalTimezoneOffsetHours(date = new Date()) {
  return -date.getTimezoneOffset() / 60;
}

/** Standard-timezone meridian longitude (east positive) when location is unknown. */
function estimateLongitudeDeg(date = new Date()) {
  const year = date.getFullYear();
  const stdOffsetMin = Math.max(
    new Date(year, 0, 1).getTimezoneOffset(),
    new Date(year, 6, 1).getTimezoneOffset(),
  );
  return (-stdOffsetMin / 60) * 15;
}

function solarDeclinationAndEqTime(dayOfYear) {
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  return { eqTime, decl };
}

function getSunriseSunsetLocalMinutes(
  latitudeDeg,
  date,
  longitudeDeg,
  timezoneOffsetHours,
) {
  const latRad = (latitudeDeg * Math.PI) / 180;
  const dayOfYear = dayOfYearFromDate(date);
  const { eqTime, decl } = solarDeclinationAndEqTime(dayOfYear);

  const cosHa =
    Math.cos((90.833 * Math.PI) / 180) / (Math.cos(latRad) * Math.cos(decl)) -
    Math.tan(latRad) * Math.tan(decl);

  if (cosHa > 1) {
    return { sunriseMinutes: 0, sunsetMinutes: 0, polarNight: true };
  }
  if (cosHa < -1) {
    return { sunriseMinutes: 0, sunsetMinutes: 1440, polarDay: true };
  }

  const hourAngleDeg = (Math.acos(cosHa) * 180) / Math.PI;
  const solarNoonLocal =
    720 - 4 * longitudeDeg - eqTime + timezoneOffsetHours * 60;
  return {
    sunriseMinutes: normalizeMinutesOfDay(solarNoonLocal - hourAngleDeg * 4),
    sunsetMinutes: normalizeMinutesOfDay(solarNoonLocal + hourAngleDeg * 4),
    solarNoonMinutes: normalizeMinutesOfDay(solarNoonLocal),
  };
}

function resolveSolarLocation(longitudeDeg, localDate) {
  const referenceDate = normalizeLocalDate(localDate) ?? new Date();
  const timezoneOffsetHours = getLocalTimezoneOffsetHours(referenceDate);
  const resolvedLongitude = Number.isFinite(longitudeDeg)
    ? longitudeDeg
    : estimateLongitudeDeg(referenceDate);
  return { longitudeDeg: resolvedLongitude, timezoneOffsetHours };
}

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

function getSunriseSunsetLocalMinutesForInputs(latitudeDeg, localDate, longitudeDeg) {
  const date = normalizeLocalDate(localDate);
  if (!date || !Number.isFinite(latitudeDeg)) return null;
  const { longitudeDeg: lon, timezoneOffsetHours } = resolveSolarLocation(longitudeDeg, localDate);
  return getSunriseSunsetLocalMinutes(latitudeDeg, date, lon, timezoneOffsetHours);
}

function getSolarIntensityFactor(
  latitudeDeg,
  date,
  timeMinutes,
  longitudeDeg,
  timezoneOffsetHours,
) {
  const referenceDate = date instanceof Date ? date : normalizeLocalDate(date) ?? new Date();
  const { longitudeDeg: lon, timezoneOffsetHours: defaultTz } = resolveSolarLocation(
    longitudeDeg,
    referenceDate,
  );
  const effectiveTz = Number.isFinite(timezoneOffsetHours)
    ? timezoneOffsetHours
    : defaultTz;
  const { sunriseMinutes, sunsetMinutes } = getSunriseSunsetLocalMinutes(
    latitudeDeg,
    referenceDate,
    lon,
    effectiveTz,
  );

  if (timeMinutes <= sunriseMinutes - TWILIGHT_MINUTES) return 0;
  if (timeMinutes >= sunsetMinutes) return 0;

  if (timeMinutes < sunriseMinutes) {
    return ((timeMinutes - (sunriseMinutes - TWILIGHT_MINUTES)) / TWILIGHT_MINUTES) * 0.25;
  }

  const noon = (sunriseMinutes + sunsetMinutes) / 2;
  const halfSpan = (sunsetMinutes - sunriseMinutes) / 2;
  if (halfSpan <= 0) return 0;
  const t = (timeMinutes - noon) / halfSpan;
  return Math.cos((t * Math.PI) / 2);
}

function resolveSolarIntensity(
  latitudeDeg,
  localDate,
  localTimeMinutes,
  longitudeDeg = null,
  timezoneOffsetHours = null,
) {
  const date = normalizeLocalDate(localDate);
  if (
    !date ||
    isNullish(localTimeMinutes) ||
    !Number.isFinite(localTimeMinutes) ||
    !Number.isFinite(latitudeDeg)
  ) {
    return 0;
  }
  return getSolarIntensityFactor(
    latitudeDeg,
    date,
    localTimeMinutes,
    longitudeDeg,
    timezoneOffsetHours,
  );
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

  const strength = formatSolarHeatingStrength(effectiveIntensity);
  const context = weatherSolarContext(weather);
  if (context) return `${capitalizeWord(strength)} (${context})`;
  return capitalizeWord(strength);
}

function describeSunlightWindow(latitudeDeg, localDate, longitudeDeg = null) {
  const date = normalizeLocalDate(localDate);
  if (!date || !Number.isFinite(latitudeDeg)) {
    return 'Set date and latitude to estimate sunrise and sunset.';
  }
  const times = getSunriseSunsetLocalMinutesForInputs(latitudeDeg, localDate, longitudeDeg);
  if (!times) {
    return 'Set date and latitude to estimate sunrise and sunset.';
  }
  const { sunriseMinutes, sunsetMinutes } = times;
  return `Sunrise ~${formatClockFromMinutes(sunriseMinutes)}, sunset ~${formatClockFromMinutes(sunsetMinutes)}`;
}

function scaleSolarFactor(factor, solarIntensity) {
  if (!factor) return null;
  return {
    ...factor,
    score: Math.round(factor.score * solarIntensity),
  };
}

function ventilationMixFraction(absDelta) {
  if (absDelta <= 3) return 0.2;
  if (absDelta <= 6) return 0.3;
  if (absDelta <= 12) return 0.4;
  if (absDelta <= 20) return 0.45;
  return 0.5;
}

function estimateVentilationTempShiftF(indoorTempF, outdoorTempF) {
  const delta = outdoorTempF - indoorTempF;
  const absDelta = Math.abs(delta);
  if (absDelta < 0.5) return 0;

  let shift = delta * ventilationMixFraction(absDelta);
  if (Math.abs(shift) > VENTILATION_MAX_SHIFT_F) {
    shift = Math.sign(shift) * VENTILATION_MAX_SHIFT_F;
  }
  return shift;
}

function ventilationShiftIsCapped(indoorTempF, outdoorTempF) {
  const delta = outdoorTempF - indoorTempF;
  const absDelta = Math.abs(delta);
  if (absDelta < 0.5) return false;
  return Math.abs(delta * ventilationMixFraction(absDelta)) > VENTILATION_MAX_SHIFT_F;
}

function estimateSolarHeatingShiftF({
  solarIntensity,
  weather,
  indoorTempF,
  outdoorTempF,
}) {
  if (solarIntensity <= 0.05) return 0;
  if (weather !== 'clear' && weather !== 'partly-cloudy') return 0;

  const delta = outdoorTempF - indoorTempF;
  const absDelta = Math.abs(delta);
  const skyFactor = weather === 'clear' ? 1 : 0.55;

  // Whole-home solar load (roof, walls, glazing, interior surfaces) when outdoor air won't net-cool.
  if (absDelta <= 2) {
    return 3.5 * solarIntensity * skyFactor;
  }

  if (absDelta <= 3 && delta < 0) {
    const fullSolar = 3.5 * solarIntensity * skyFactor;
    const ventShift = estimateVentilationTempShiftF(indoorTempF, outdoorTempF);
    const offset = 2.5 * solarIntensity * skyFactor;
    const partialSolar =
      ventShift < 0 ? Math.min(offset, Math.abs(ventShift) * 0.6) : offset * 0.5;
    const blend = 3 - absDelta;
    return fullSolar * blend + partialSolar * (1 - blend);
  }

  if (delta < -2) {
    const offset = 2.5 * solarIntensity * skyFactor;
    const ventShift = estimateVentilationTempShiftF(indoorTempF, outdoorTempF);
    if (ventShift < 0) {
      return Math.min(offset, Math.abs(ventShift) * 0.6);
    }
    return offset * 0.5;
  }

  if (delta > 2) {
    // Outdoor air is already warmer; ventilation shift captures that warming path.
    return 0;
  }

  return 0;
}

function estimateInternalGainShiftF(needs, ventilationEffectiveness = 1) {
  if (needs.includes('warm') && !needs.includes('cool')) return 0;
  const effectiveness = Number.isFinite(ventilationEffectiveness) ? ventilationEffectiveness : 1;
  return INTERNAL_GAIN_SHIFT_F * (0.25 + 0.75 * effectiveness);
}

function describePassiveHeatingSources({
  solarHeatingShiftF,
  internalGainShiftF,
  solarIntensity,
  weather,
}) {
  const sunnySky = weather === 'clear' || weather === 'partly-cloudy';
  const hasSolar = solarHeatingShiftF >= 1 && sunnySky && solarIntensity >= 0.35;
  const hasInternal = internalGainShiftF >= 0.5;
  if (hasSolar && hasInternal) {
    return 'Solar load plus heat from people, pets, and appliances';
  }
  if (hasSolar) return 'Solar load on the building';
  if (hasInternal) return 'Heat from people, pets, and appliances';
  return 'Passive heat gain';
}

function formatVentilationShift(shiftF, unit, { capped = false } = {}) {
  if (Math.abs(shiftF) < 0.5) return 'little air-temp change';
  const amount = formatDelta(Math.abs(shiftF), unit);
  const direction = shiftF < 0 ? 'cooler' : 'warmer';
  let text = `roughly ${amount} ${direction}`;
  if (capped) text += ' -- whole home won\'t reach outdoor temp';
  return text;
}

function matchedTempBlendFactor(absDelta) {
  if (absDelta <= 2) return 1;
  if (absDelta >= 3) return 0;
  return 3 - absDelta;
}

function formatExpectedShiftDisplay(shiftF, unit, { capped = false } = {}) {
  return formatVentilationShift(shiftF, unit, { capped });
}

function netShiftFromThermalContext(thermalContext, indoorTempF, outdoorTempF) {
  if (Number.isFinite(thermalContext.expectedShiftF)) {
    return thermalContext.expectedShiftF;
  }
  const airShiftF = estimateVentilationTempShiftF(indoorTempF, outdoorTempF);
  const { solarHeatingShiftF = 0, internalGainShiftF = 0 } = thermalContext;
  return airShiftF + solarHeatingShiftF + internalGainShiftF;
}

function formatContextualShift(thermalContext, indoorTempF, outdoorTempF, unit, options = {}) {
  const shiftF = netShiftFromThermalContext(thermalContext, indoorTempF, outdoorTempF);
  const capped = options.capped ?? thermalContext.ventilationShiftCapped ?? false;
  return formatVentilationShift(shiftF, unit, { capped });
}

function scaleHumidityScoreByVentilation(score, effectiveness) {
  if (!Number.isFinite(effectiveness) || effectiveness >= 0.98 || score === 0) return score;
  const scaled = Math.abs(score) * (0.2 + 0.8 * effectiveness);
  return Math.round(Math.sign(score) * scaled);
}

function limitedVentilationHumidityNote(effectiveness) {
  if (!Number.isFinite(effectiveness) || effectiveness >= 0.45) return '';
  return ' With limited window opening, moisture change at your floor will be slower.';
}

function scoreTemperatureMaintainBand(
  indoorTempF,
  outdoorTempF,
  tempLowF,
  tempHighF,
  unit,
  thermalContext = {},
) {
  const {
    solarHeatingShiftF = 0,
    internalGainShiftF = 0,
    weather,
    solarIntensity = 0,
    ventilationShiftCapped = false,
  } = thermalContext;
  const airShiftF = estimateVentilationTempShiftF(indoorTempF, outdoorTempF);
  const idealNetShiftF = airShiftF + solarHeatingShiftF + internalGainShiftF;
  const shiftF = netShiftFromThermalContext(thermalContext, indoorTempF, outdoorTempF);
  const estIndoorF = indoorTempF + shiftF;
  const absShift = Math.abs(shiftF);
  const estAboveMax = estIndoorF - tempHighF;
  const estBelowMin = tempLowF - estIndoorF;
  const estInBand = estIndoorF >= tempLowF && estIndoorF <= tempHighF;
  const shiftDesc = formatVentilationShift(shiftF, unit, { capped: ventilationShiftCapped });
  const passiveSources = describePassiveHeatingSources({
    solarHeatingShiftF,
    internalGainShiftF,
    solarIntensity,
    weather,
  });
  const outdoorNote = ` (outdoor is ${formatTemp(outdoorTempF, unit)}, but the whole home won't reach that)`;
  const factorBase = {
    shiftF,
    airShiftF,
    solarHeatingShiftF,
    internalGainShiftF,
    idealNetShiftF,
  };

  if (shiftF >= 0.5) {
    if (estAboveMax > 1.5) {
      return {
        score: -16,
        impact: 'hurt',
        title: 'Net warming should push temps above comfort',
        body: `Expect ${shiftDesc} indoors -- likely past your ${formatComfortRange(tempLowF, tempHighF, unit)} range as ${passiveSources.toLowerCase()} outweigh modest outdoor cooling.`,
        ...factorBase,
      };
    }
    if (estAboveMax > 0) {
      return {
        score: -12,
        impact: 'hurt',
        title: 'Net warming should exceed your comfort max',
        body: `Expect ${shiftDesc} indoors, above your ${formatTemp(tempHighF, unit)} maximum -- outdoor air is not cool enough to offset ${passiveSources.toLowerCase()}.`,
        ...factorBase,
      };
    }
    if (shiftF >= 2) {
      return {
        score: -8,
        impact: 'hurt',
        title: 'Net warming expected',
        body: `Expect ${shiftDesc} indoors -- ${passiveSources.toLowerCase()} should outweigh the modest cooling from outdoor air.`,
        ...factorBase,
      };
    }
    return {
      score: -4,
      impact: 'mixed',
      title: 'Modest net warming expected',
      body: `Expect ${shiftDesc} indoors -- outdoor air is only slightly cooler, so ${passiveSources.toLowerCase()} may still nudge temps up.`,
      ...factorBase,
    };
  }

  if (shiftF <= -0.5) {
    if (estBelowMin > 5) {
      return {
        score: -28,
        impact: 'hurt',
        title: 'Likely too much cooling',
        body: `Expect ${shiftDesc} indoors -- probably below your ${formatTemp(tempLowF, unit)} minimum${outdoorNote}.`,
        ...factorBase,
      };
    }
    if (estBelowMin > 3) {
      return {
        score: -14,
        impact: 'mixed',
        title: 'Some cooling below your minimum',
        body: `Expect ${shiftDesc} indoors -- may drift below your ${formatTemp(tempLowF, unit)} floor${outdoorNote}.`,
        ...factorBase,
      };
    }
    if (estBelowMin > 1.5) {
      return {
        score: 2,
        impact: 'mixed',
        title: 'Slight dip below your range',
        body: `Expect ${shiftDesc} indoors -- possibly a touch below your ${formatTemp(tempLowF, unit)} minimum if left open long${outdoorNote}.`,
        ...factorBase,
      };
    }
    if (estBelowMin > 0) {
      return {
        score: 12,
        impact: 'mixed',
        title: 'Slight dip below your range',
        body: `Expect ${shiftDesc} indoors -- possibly a touch below your ${formatTemp(tempLowF, unit)} minimum if left open long${outdoorNote}.`,
        ...factorBase,
      };
    }
    const score = absShift >= 5 ? 18 : absShift >= 2 ? 16 : absShift >= 1 ? 12 : 8;
    return {
      score,
      impact: absShift >= 2 ? 'help' : 'mixed',
      title:
        absShift >= 2
          ? 'Good for fresh air -- modest shift expected'
          : 'Slight net cooling expected',
      body: `Expect ${shiftDesc} indoors -- likely still within your ${formatComfortRange(tempLowF, tempHighF, unit)} range${outdoorNote}.`,
      ...factorBase,
    };
  }

  return {
    score: estInBand ? 3 : 0,
    impact: 'neutral',
    title: 'Little net temperature change',
    body: `Expect ${shiftDesc} indoors -- outdoor air is close to your comfort range, so ventilation mainly freshens the air.`,
    ...factorBase,
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

/** Outdoor dew point at least thresholdF lower than indoor -- ventilation can dry the home. */
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
  if (Math.abs(delta) < 0.5) return 'About the same dew point';
  if (delta < 0) return `Outdoor dew point ${formatDelta(-delta, unit)} lower`;
  return `Outdoor dew point ${formatDelta(delta, unit)} higher`;
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
          body: `Outdoor dew point is much lower even though air is ${formatDelta(-delta, unit)} cooler -- ventilation trades warmth for moisture removal; short bursts work best.`,
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
        body: `Outdoor air is ${formatDelta(-delta, unit)} cooler and drier -- ventilation will strip humidity without warming meaningfully.`,
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

function scoreTemperatureCool(
  indoorTempF,
  outdoorTempF,
  unit,
  indoorRh,
  outdoorRh,
  needs,
  thermalContext,
) {
  const delta = outdoorTempF - indoorTempF;
  const netShift = netShiftFromThermalContext(thermalContext, indoorTempF, outdoorTempF);
  const effectiveness = thermalContext.ventilationEffectiveness ?? 1;
  const limitedVent = effectiveness < 0.45;
  const shiftDesc = formatContextualShift(thermalContext, indoorTempF, outdoorTempF, unit);
  const solarNote =
    thermalContext.solarHeatingShiftF > 0.5
      ? ', though sunlight warming the home can offset some of the gain'
      : '';
  const stickyAndDrier =
    needs.includes('dehumidify') &&
    isMuchDrierOutdoor(indoorTempF, indoorRh, outdoorTempF, outdoorRh);

  if (netShift >= 0.5) {
    if (delta > 0) {
      if (stickyAndDrier && delta <= 6) {
        return {
          score: 2,
          impact: 'mixed',
          title: 'Warmer outside, but drier air may still help',
          body: `Outdoor air is ${formatDelta(delta, unit)} warmer, yet much lower dew point can ease stuffiness -- expect ${shiftDesc}, so cooling will be limited.`,
        };
      }
      if (stickyAndDrier && delta <= 10) {
        return {
          score: -8,
          impact: 'mixed',
          title: 'Warmer outside, but notably drier',
          body: `Outdoor air is ${formatDelta(delta, unit)} warmer -- expect ${shiftDesc}; the lower dew point may still ease stuffiness.`,
        };
      }
      return {
        score: delta >= 6 ? -22 : -18,
        impact: 'hurt',
        title: delta >= 6 ? 'Outdoor air is warmer -- cooling will suffer' : 'Net warming expected',
        body: `Expect ${shiftDesc} indoors -- outdoor air works against cooling your home.`,
      };
    }
    return {
      score: -14,
      impact: 'hurt',
      title: 'Limited cooling at your floor',
      body: `Outdoor air is ${formatDelta(-delta, unit)} cooler, but with your window setup expect ${shiftDesc}${limitedVent ? ' — passive heat and limited mixing offset the outdoor air' : ' — passive heat may offset the gain'}.`,
    };
  }

  if (netShift > -0.5) {
    if (stickyAndDrier && delta > -3) {
      return {
        score: 8,
        impact: 'mixed',
        title: 'Slightly warmer outside, but much drier',
        body: 'Outdoor air is a touch warmer yet the dew point is notably lower -- expect humidity relief with little or no cooling.',
      };
    }
    if (Math.abs(delta) <= 1) {
      return {
        score: -5,
        impact: 'neutral',
        title: 'Little temperature benefit',
        body: `Indoor and outdoor temperatures are nearly the same -- expect ${shiftDesc} if you ventilate.`,
      };
    }
    if (delta <= -3) {
      return {
        score: limitedVent ? 2 : 6,
        impact: 'mixed',
        title: 'Outdoor air is cooler -- limited net cooling',
        body: `Outdoor air is ${formatDelta(-delta, unit)} cooler, but expect ${shiftDesc} at your floor${limitedVent ? ' with limited window opening' : ''}.`,
      };
    }
    if (stickyAndDrier && delta <= 6) {
      return {
        score: 2,
        impact: 'mixed',
        title: 'Warmer outside, but drier air may still help',
        body: `Outdoor air is ${formatDelta(delta, unit)} warmer, yet much lower dew point can ease stuffiness -- expect ${shiftDesc}.`,
      };
    }
    if (stickyAndDrier && delta <= 10) {
      return {
        score: -8,
        impact: 'mixed',
        title: 'Warmer outside, but notably drier',
        body: `Outdoor air is ${formatDelta(delta, unit)} warmer -- expect ${shiftDesc}; the lower dew point may still ease stuffiness.`,
      };
    }
    return {
      score: -22,
      impact: 'hurt',
      title: 'Outdoor air is warmer -- cooling will suffer',
      body: `You would be letting in air about ${formatDelta(delta, unit)} warmer than inside -- expect ${shiftDesc}.`,
    };
  }

  const absNet = Math.abs(netShift);
  if (delta <= -8 || absNet >= 3) {
    return {
      score: Math.min(30, Math.round(12 + absNet * 4)),
      impact: 'help',
      title: absNet >= 3 ? 'Should cool noticeably at your floor' : 'Outdoor air is much cooler',
      body: `Outdoor air is ${formatDelta(-delta, unit)} cooler -- expect ${shiftDesc} indoors${solarNote}.`,
    };
  }
  if (delta <= -3 || absNet >= 1.5) {
    return {
      score: Math.min(14, Math.round(5 + absNet * 3)),
      impact: absNet >= 2 ? 'help' : 'mixed',
      title: 'Modest cooling from outdoor air',
      body: `Outdoor air is ${formatDelta(-delta, unit)} cooler. Expect ${shiftDesc} indoors -- gradual, and less than the full gap to outside.`,
    };
  }
  return {
    score: 8,
    impact: 'mixed',
    title: 'Slight cooling expected',
    body: `Expect ${shiftDesc} indoors.`,
  };
}

function scoreTemperatureWarm(indoorTempF, outdoorTempF, unit, thermalContext) {
  const delta = outdoorTempF - indoorTempF;
  const netShift = netShiftFromThermalContext(thermalContext, indoorTempF, outdoorTempF);
  const shiftDesc = formatContextualShift(thermalContext, indoorTempF, outdoorTempF, unit);

  if (netShift <= -5 || delta <= -15) {
    return {
      score: -45,
      impact: 'hurt',
      title: 'Very cold outdoor air',
      body: `Letting in frigid air will overwhelm most heating -- expect ${shiftDesc}.`,
    };
  }
  if (netShift <= -2 || delta <= -10) {
    return {
      score: -28,
      impact: 'hurt',
      title: 'Cold outdoor air will steal heat',
      body: `Outdoor air is about ${formatDelta(-delta, unit)} colder -- expect ${shiftDesc} indoors, not a full drop to outdoor temp.`,
    };
  }
  if (netShift <= -0.5 && delta < -3) {
    return {
      score: -20,
      impact: 'hurt',
      title: 'Cold outdoor air will steal heat',
      body: `Outdoor air is cooler than inside -- expect ${shiftDesc}, working against warming.`,
    };
  }
  if (delta >= 8 && netShift >= 0.3) {
    return {
      score: 12,
      impact: 'mixed',
      title: 'Outdoor air could warm the home slowly',
      body: `Outdoor air is ${formatDelta(delta, unit)} warmer -- expect ${shiftDesc}; window ventilation alone is a weak substitute for running heat.`,
    };
  }
  if (delta >= 3 && netShift >= 0.2) {
    return {
      score: 4,
      impact: 'mixed',
      title: 'Limited warming from ventilation',
      body: `Outdoor air is a bit warmer -- expect ${shiftDesc}; windows alone will not replace your heating system meaningfully.`,
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
  return {
    score: -28,
    impact: 'hurt',
    title: 'Cold outdoor air will steal heat',
    body: `Outdoor air is about ${formatDelta(-delta, unit)} colder -- expect ${shiftDesc} indoors.`,
  };
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
  thermalContext = {},
) {
  const { tempLowF, tempHighF } = normalizeComfortBounds(comfortMinF, comfortMaxF);
  const inComfortBand = indoorTempF >= tempLowF && indoorTempF <= tempHighF;

  if (needs.includes('cool')) {
    return scoreTemperatureCool(
      indoorTempF,
      outdoorTempF,
      unit,
      indoorRh,
      outdoorRh,
      needs,
      thermalContext,
    );
  }

  if (needs.includes('warm')) {
    return scoreTemperatureWarm(indoorTempF, outdoorTempF, unit, thermalContext);
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
    return scoreTemperatureMaintainBand(
      indoorTempF,
      outdoorTempF,
      tempLowF,
      tempHighF,
      unit,
      thermalContext,
    );
  }

  if (moistureGoal) return moistureGoal;

  if (inComfortBand) {
    return scoreTemperatureMaintainBand(
      indoorTempF,
      outdoorTempF,
      tempLowF,
      tempHighF,
      unit,
      thermalContext,
    );
  }

  return {
    score: 0,
    impact: 'neutral',
    title: 'Temperature impact is neutral',
    body: 'Indoor and outdoor temperatures are unlikely to shift comfort on their own.',
  };
}

function scoreHumidity(indoorTempF, indoorRh, outdoorTempF, outdoorRh, needs, thermalContext = {}) {
  const {
    solarHeatingShiftF = 0,
    internalGainShiftF = 0,
    ventilationEffectiveness = 1,
  } = thermalContext;
  const passiveHeatingShiftF = solarHeatingShiftF + internalGainShiftF;
  const absTempDelta = Math.abs(outdoorTempF - indoorTempF);
  const indoorDp = dewPointFahrenheit(indoorTempF, indoorRh);
  const outdoorDp = dewPointFahrenheit(outdoorTempF, outdoorRh);
  const indoorAh = absoluteHumidityGpm3(indoorTempF, indoorRh);
  const outdoorAh = absoluteHumidityGpm3(outdoorTempF, outdoorRh);
  const dpDelta =
    indoorDp === null || outdoorDp === null ? 0 : outdoorDp - indoorDp;
  const ahDelta = outdoorAh - indoorAh;
  const ventNote = limitedVentilationHumidityNote(ventilationEffectiveness);

  const withDewPoints = (factor) => ({
    ...factor,
    indoorDp,
    outdoorDp,
    score: scaleHumidityScoreByVentilation(factor.score, ventilationEffectiveness),
    body: `${factor.body}${ventNote && factor.score > 0 ? ventNote : ''}`,
  });

  if (needs.includes('dehumidify')) {
    const aboveRhTarget = indoorRh > COMFORT.rhTargetMax;
    const stuffyNote = aboveRhTarget
      ? ` Indoor humidity (${Math.round(indoorRh)}%) is above your ~50% comfort target -- dryness matters as much as temperature.`
      : '';

    if (dpDelta <= -5) {
      return withDewPoints({
        score: aboveRhTarget ? 28 : 25,
        impact: 'help',
        title: aboveRhTarget
          ? 'Outdoor air is drier -- should ease stuffiness'
          : 'Outdoor air is drier -- humidity should drop',
        body: `Lower outdoor dew point means incoming air can absorb moisture and help dry out stale indoor air.${stuffyNote}`,
      });
    }
    if (dpDelta <= -1) {
      if (passiveHeatingShiftF >= 1 && absTempDelta <= 2 && dpDelta > -3) {
        return withDewPoints({
          score: 0,
          impact: 'neutral',
          title: 'Drying benefit too small to offset indoor heat',
          body: `Outdoor air is only slightly drier, while ${describePassiveHeatingSources(thermalContext).toLowerCase()} should warm the home -- ventilation is unlikely to improve overall comfort.${stuffyNote}`,
        });
      }
      return withDewPoints({
        score: aboveRhTarget ? 14 : 10,
        impact: 'mixed',
        title: aboveRhTarget
          ? 'Modest drying -- may help muggy air'
          : 'Slight dehumidifying effect',
        body: `Outdoor moisture levels are a bit lower. You may feel modest relief, but it might not fix a very damp home on its own.${stuffyNote}`,
      });
    }
    if (dpDelta <= 3) {
      return withDewPoints({
        score: aboveRhTarget ? -14 : -8,
        impact: aboveRhTarget ? 'mixed' : 'neutral',
        title: aboveRhTarget
          ? 'Humidity already high -- little relief expected'
          : 'Humidity levels are similar',
        body: aboveRhTarget
          ? `Indoor and outdoor moisture are close, so ventilation will not pull humidity below your ~50% target -- the home may still feel stuffy.${stuffyNote}`
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
        body: 'If the home feels dry, outdoor air may add a little humidity -- though whole-house change will be gradual.',
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
      body: 'Could freshen the air and nudge humidity down a touch -- helpful if it felt stuffy, unnecessary if already comfortable.',
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
      body: `Indoor dew point (${formatTemp(indoorDp, unit)}) is well above likely glass temperature (${formatTemp(glassTempEstimate, unit)}) -- expect fogging and water on frames.`,
    };
  }

  if (dewPointMargin >= 5 && outdoorTempF < indoorTempF - 5) {
    return {
      score: -22,
      impact: 'mixed',
      title: 'Likely window condensation',
      body: 'Warm, moist indoor air hitting cold glass may bead up -- crack windows rather than opening wide, or ventilate in short bursts.',
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
        title: 'Dark outside -- no solar heating',
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
        body: 'Sunny skies warm the home through windows, walls, and roof, but much drier outdoor air can still ease stuffiness -- shade sun-facing windows if you ventilate.',
      });
    }
    return finish({
      score: sunny ? -10 : partlySunny ? -6 : -4,
      impact: 'mixed',
      title: 'Sun can warm the home',
      body: 'Sunny weather adds heat to the building while warmer outdoor air flows in -- ventilation works against your cooling goal.',
    });
  }

  if (maintainFreshAir) {
    if (overcast && absDelta >= 3) {
      return finish({
        score: absDelta >= 8 ? 5 : 3,
        impact: 'help',
        title: 'Overcast and cool -- great for fresh air',
        body: 'You\'re already comfortable. Cool, overcast outdoor air should freshen the home without overshooting your range.',
      });
    }

    if (absDelta >= 12) {
      return finish({
        score: sunny ? 3 : 4,
        impact: 'help',
        title: sunny ? 'Cool outdoor air -- good for fresh air' : 'Cool outdoor air helps',
        body: 'You\'re already comfortable. Much cooler outdoor air should freshen the home; sun may soften the effect, but you are unlikely to overshoot your range.',
      });
    }

    if (absDelta >= 7) {
      return finish({
        score: sunny ? 2 : partlySunny ? 3 : 4,
        impact: 'help',
        title: sunny ? 'Cool outdoor air -- good time to freshen up' : 'Cool outdoor air helps',
        body: 'You\'re already comfortable. Cooler outdoor air should freshen the home and nudge temps down a bit -- sunny weather may soften the effect, but you should stay in your comfort range.',
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
      body: 'Indoor and outdoor temps are close -- ventilation is mainly for air freshness.',
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
          ? 'Outdoor air is much cooler than inside, so ventilation should still help -- but sunlight warming the home will offset some of the gain.'
          : 'Cool outdoor air can pull heat out with less solar heating on the building.',
      });
    }

    if (absDelta >= 7) {
      return finish({
        score: sunny ? -3 : partlySunny ? -1 : 1,
        impact: 'mixed',
        title: sunny ? 'Sun competes with modest cooling' : 'Partly sunny -- cooling may be uneven',
        body: 'Cool outdoor air helps, but sunny weather keeps adding heat to the home and can cancel much of the temperature drop.',
      });
    }

    if (absDelta >= 3) {
      return finish({
        score: sunny ? -6 : partlySunny ? -4 : 0,
        impact: 'mixed',
        title: sunny ? 'Sunny day limits net cooling' : 'Expect limited temperature change',
        body: 'Outdoor air is only modestly cooler; in sunny weather the building keeps gaining heat, so net cooling is often small -- openings mainly freshen the air.',
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
        ? 'Sunny weather heats the building while warmer outdoor air flows in -- an already-comfortable home may slowly feel warmer.'
        : 'Warmer outdoor air may nudge an already-comfortable room warmer over time.',
    });
  }

  if (needs.includes('maintain') && absDelta <= 3) {
    const matchedBlend = matchedTempBlendFactor(absDelta);
    if (matchedBlend > 0 && (weather === 'clear' || weather === 'partly-cloudy')) {
      const baseScore = weather === 'clear' ? -8 : -5;
      return finish({
        score: Math.round(baseScore * matchedBlend),
        impact: solarIntensity >= 0.5 * matchedBlend ? 'hurt' : 'mixed',
        title:
          weather === 'clear'
            ? 'Strong solar load on the building'
            : 'Sun may warm the building',
        body:
          'Outdoor air is close to indoor temperature, so ventilation alone will not cool much. Sunlight still heats the roof, walls, and interior.',
      });
    }
    if (matchedBlend > 0) {
      return finish({
        score: 0,
        impact: 'neutral',
        title: 'Mild weather impact',
        body: 'Indoor and outdoor temps are close -- ventilation is mainly for air freshness.',
      });
    }
  }

  return null;
}

/** Assumed mph when windy is checked but no speed is entered. */
const DEFAULT_WIND_SPEED_MPH = 12;

function resolveWindSpeedMph(windy, windSpeedMph) {
  if (!windy) return null;
  const speed = Number(windSpeedMph);
  if (Number.isFinite(speed) && speed >= 0) return speed;
  return DEFAULT_WIND_SPEED_MPH;
}

function formatWindSpeedMetric(windy, windSpeedMph) {
  if (!windy) return null;
  const raw = Number(windSpeedMph);
  if (Number.isFinite(raw) && raw >= 0) return `${Math.round(raw)} mph`;
  return `~${DEFAULT_WIND_SPEED_MPH} mph (typical breeze assumed)`;
}

function windExchangeMultiplier(windSpeedMph) {
  if (windSpeedMph <= 5) return 0.45;
  if (windSpeedMph <= 12) return 0.75;
  if (windSpeedMph <= 20) return 1;
  if (windSpeedMph <= 30) return 1.2;
  return 1.35;
}

function resolveVentilationEffectiveness({
  windowOpening,
  floorsOpen,
  storyCount,
  homeType,
  windy = false,
  windSpeedMph = null,
}) {
  let factor =
    windowOpeningFactor(windowOpening) *
    floorsOpenFactor(floorsOpen, storyCount) *
    homeTypeFactor(homeType);

  if (windy) {
    const mph = resolveWindSpeedMph(windy, windSpeedMph);
    if (mph !== null) {
      const windBoost = windExchangeMultiplier(mph);
      factor *= 0.75 + 0.25 * windBoost;
    }
  }

  return Math.max(0.06, Math.min(1, factor));
}

function mergeWeatherFactors(skyFactor, windFactor) {
  if (!windFactor) return skyFactor;

  const score = skyFactor.score + windFactor.score;
  const dominant =
    Math.abs(windFactor.score) >= Math.abs(skyFactor.score) ? windFactor : skyFactor;
  const impact =
    score <= -8
      ? 'hurt'
      : score <= -2
        ? 'mixed'
        : score >= 8
          ? 'help'
          : dominant.impact;
  const title = dominant.title;
  const body =
    skyFactor.score !== 0 && windFactor.score !== 0 && skyFactor.title !== windFactor.title
      ? `${skyFactor.body} ${windFactor.body}`
      : dominant.body;

  return { score, impact, title, body };
}

function scoreWindExchange(
  indoorTempF,
  indoorRh,
  outdoorTempF,
  outdoorRh,
  needs,
  tempLowF,
  windSpeedMph,
  thermalContext = {},
) {
  const multiplier = windExchangeMultiplier(windSpeedMph);
  const scale = (value) => Math.round(value * multiplier);
  const delta = outdoorTempF - indoorTempF;
  const netShiftF = netShiftFromThermalContext(thermalContext, indoorTempF, outdoorTempF);
  const estIndoorF = indoorTempF + netShiftF;
  const unfavorable =
    (needs.includes('cool') &&
      delta >= 1 &&
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
      score: scale(-6),
      impact: 'mixed',
      title: 'Wind accelerates unwanted exchange',
      body:
        windSpeedMph >= 20
          ? 'Strong wind pulls outdoor air in faster -- amplifying the temperature or moisture mismatch.'
          : 'A breeze pulls outdoor air in faster -- amplifying the temperature or moisture mismatch.',
    };
  }

  if (needs.includes('maintain') && Math.abs(delta) >= 3 && Math.abs(delta) < 8) {
    return {
      score: scale(3),
      impact: 'neutral',
      title: 'Breeze helps air exchange',
      body: 'Wind moves air faster, but the modest indoor/outdoor gap still limits how much temperature or humidity will shift.',
    };
  }

  return {
    score: scale(8),
    impact: 'help',
    title: 'Breeze improves air exchange',
    body:
      windSpeedMph >= 20
        ? 'Strong wind flushes stale indoor air quickly, so favorable outdoor conditions do more work in less time.'
        : 'Wind helps flush stale indoor air faster, so favorable outdoor conditions do more work in less time.',
  };
}

function scoreSkyWeather(
  weather,
  indoorTempF,
  indoorRh,
  outdoorTempF,
  outdoorRh,
  needs,
  solarIntensity = 1,
) {
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
          body: 'Keep openings small and watch sills -- outdoor dew point is lower than inside even though it is raining.',
        };
      }

      return {
        score: needs.includes('dehumidify') ? -20 : -8,
        impact: needs.includes('dehumidify') ? 'hurt' : 'mixed',
        title: 'Rain usually means wetter air',
        body: needs.includes('dehumidify')
          ? 'Rain and post-storm air often carry extra moisture -- poor timing if you need to dry the home.'
          : 'Keep openings smaller and watch sills; rain raises humidity and can blow in water.',
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
  windy = false,
  windSpeedMph = null,
  thermalContext = {},
) {
  const { tempLowF } = normalizeComfortBounds(comfortMinF, comfortMaxF);
  const skyFactor = scoreSkyWeather(
    weather,
    indoorTempF,
    indoorRh,
    outdoorTempF,
    outdoorRh,
    needs,
    solarIntensity,
  );
  const resolvedWindMph = resolveWindSpeedMph(windy, windSpeedMph);
  if (resolvedWindMph === null) return skyFactor;

  const windFactor = scoreWindExchange(
    indoorTempF,
    indoorRh,
    outdoorTempF,
    outdoorRh,
    needs,
    tempLowF,
    resolvedWindMph,
    thermalContext,
  );
  return mergeWeatherFactors(skyFactor, windFactor);
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
      return `Opening windows may help a little -- but expect modest gains`;
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
    return `${joined} The improvement may be small -- try a short airing if you mainly want fresher air.`;
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
  longitudeDeg = null,
  localDate = null,
  localTimeMinutes = null,
  windy = false,
  windSpeedMph = null,
  homeType,
  storyCount,
  windowOpening,
  floorsOpen,
  sunExposure,
  tempMeasurementFloor,
}) {
  const comfortBand = normalizeComfortBounds(comfortMinF, comfortMaxF);
  const homeProfile = normalizeHomeProfile({
    homeType,
    storyCount,
    windowOpening,
    floorsOpen,
    sunExposure,
    tempMeasurementFloor,
  });
  const solarIntensity = resolveSolarIntensity(
    latitudeDeg,
    localDate,
    localTimeMinutes,
    longitudeDeg,
  );
  const needs = inferIndoorNeeds(
    indoorTempF,
    indoorRh,
    comfortBand.tempLowF,
    comfortBand.tempHighF,
  );
  const sunMult = sunExposureMultiplier(homeProfile.sunExposure);
  const idealVentilationShiftF = estimateVentilationTempShiftF(indoorTempF, outdoorTempF);
  const ventilationShiftCapped = ventilationShiftIsCapped(indoorTempF, outdoorTempF);
  const ventilationEffectiveness = resolveVentilationEffectiveness({
    windowOpening: homeProfile.windowOpening,
    floorsOpen: homeProfile.floorsOpen,
    storyCount: homeProfile.storyCount,
    homeType: homeProfile.homeType,
    windy,
    windSpeedMph,
  });
  const internalGainShiftF = estimateInternalGainShiftF(needs, ventilationEffectiveness);
  const baseSolarHeatingShiftF = estimateSolarHeatingShiftF({
    solarIntensity,
    weather,
    indoorTempF,
    outdoorTempF,
  });
  const scoringSolarHeatingShiftF = baseSolarHeatingShiftF * sunMult;
  const shiftAtFloor = computeShiftAtMeasurementFloor({
    indoorTempF,
    idealVentilationShiftF,
    baseSolarHeatingShiftF,
    internalGainShiftF,
    ventilationEffectiveness,
    sunExposure: homeProfile.sunExposure,
    tempMeasurementFloor: homeProfile.tempMeasurementFloor,
    storyCount: homeProfile.storyCount,
  });
  const idealExpectedShiftF =
    idealVentilationShiftF + scoringSolarHeatingShiftF + internalGainShiftF;
  const thermalContext = {
    solarIntensity,
    weather,
    baseSolarHeatingShiftF,
    solarHeatingShiftF: scoringSolarHeatingShiftF,
    internalGainShiftF,
    expectedShiftF: shiftAtFloor.expectedShiftF,
    idealExpectedShiftF,
    ventilationEffectiveness,
    ventilationShiftCapped,
    indoorTempF,
    outdoorTempF,
  };
  const tempFactor = scoreTemperature(
    indoorTempF,
    outdoorTempF,
    needs,
    unit,
    indoorRh,
    outdoorRh,
    comfortBand.tempLowF,
    comfortBand.tempHighF,
    thermalContext,
  );
  const humidityFactor = scoreHumidity(
    indoorTempF,
    indoorRh,
    outdoorTempF,
    outdoorRh,
    needs,
    thermalContext,
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
    windy,
    windSpeedMph,
    thermalContext,
  );

  const totalScore =
    tempFactor.score +
    humidityFactor.score +
    condensationFactor.score +
    weatherFactor.score;

  const verdict = pickVerdict(totalScore);
  const coolingOutlook = buildCoolingOutlook({
    verdict,
    needs,
    idealExpectedShiftF,
    expectedShiftF: shiftAtFloor.expectedShiftF,
    ventilationEffectiveness,
    homeProfile,
    unit,
  });
  const humidityOutlook = buildHumidityOutlook({
    needs,
    humidityFactor,
    ventilationEffectiveness,
    indoorRh,
    indoorTempF,
    outdoorTempF,
    outdoorRh,
    homeProfile,
  });

  return {
    needs,
    verdict,
    totalScore,
    comfortBand,
    homeProfile,
    ventilationEffectiveness,
    idealVentilationShiftF,
    idealExpectedShiftF,
    idealEstimatedIndoorF: indoorTempF + idealExpectedShiftF,
    ventilationShiftF: shiftAtFloor.ventilationShiftF,
    solarHeatingShiftF: shiftAtFloor.solarHeatingShiftF,
    internalGainShiftF,
    expectedShiftF: shiftAtFloor.expectedShiftF,
    ventilationShiftCapped,
    estimatedIndoorF: shiftAtFloor.estimatedIndoorF,
    coolingOutlook,
    humidityOutlook,
    solarIntensity,
    tempFactor,
    humidityFactor,
    condensationFactor,
    weatherFactor,
  };
}

export {
  COMFORT,
  COMFORT_DEFAULT_MIN_F,
  COMFORT_DEFAULT_MAX_F,
  COMFORT_MIN_SPAN_F,
  COMFORT_LEGACY_TOLERANCE_F,
  VENTILATION_MAX_SHIFT_F,
  INTERNAL_GAIN_SHIFT_F,
  DEFAULT_LATITUDE_DEG,
  DEFAULT_LONGITUDE_DEG,
  DEFAULT_HOME_PROFILE,
  TWILIGHT_MINUTES,
  VERDICTS,
  normalizeHomeProfile,
  normalizeFloorsOpen,
  resolveVentilationEffectiveness,
  computeShiftAtMeasurementFloor,
  describeVentilationSetup,
  buildCoolingOutlook,
  buildHumidityOutlook,
  scoreTemperatureCool,
  scoreTemperatureWarm,
  sunExposureMultiplier,
  isNullish,
  normalizeComfortBounds,
  comfortBoundsFromLegacyTarget,
  normalizeLocalDate,
  dayOfYearFromDate,
  getSunriseSunsetLocalMinutes,
  getSunriseSunsetLocalMinutesForInputs,
  getLocalTimezoneOffsetHours,
  estimateLongitudeDeg,
  resolveSolarLocation,
  getSolarIntensityFactor,
  resolveSolarIntensity,
  formatClockFromMinutes,
  weatherSolarMultiplier,
  weatherSolarContext,
  formatSolarHeatingStrength,
  formatSolarHeatingMetric,
  describeSunlightWindow,
  scaleSolarFactor,
  estimateVentilationTempShiftF,
  estimateSolarHeatingShiftF,
  estimateInternalGainShiftF,
  ventilationShiftIsCapped,
  formatVentilationShift,
  formatExpectedShiftDisplay,
  formatContextualShift,
  netShiftFromThermalContext,
  scaleHumidityScoreByVentilation,
  formatWindSpeedMetric,
  resolveWindSpeedMph,
  scoreTemperatureMaintainBand,
  toFahrenheit,
  fromFahrenheit,
  formatTemp,
  formatDelta,
  formatComfortRange,
  dewPointCelsius,
  dewPointFahrenheit,
  absoluteHumidityGpm3,
  getDewPoints,
  isMuchDrierOutdoor,
  inferIndoorNeeds,
  formatTempDifference,
  formatDewPointDifference,
  scoreTemperatureForMoistureGoal,
  scoreTemperature,
  scoreHumidity,
  scoreCondensationRisk,
  scoreSolarVentilationEffect,
  scoreWeather,
  pickVerdict,
  buildHeadline,
  buildSummary,
  evaluateConditions,
};
