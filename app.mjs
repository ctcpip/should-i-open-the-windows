import {
  COMFORT_DEFAULT_MAX_F,
  COMFORT_DEFAULT_MIN_F,
  COMFORT_MIN_SPAN_F,
  DEFAULT_LATITUDE_DEG,
  buildHeadline,
  buildSummary,
  comfortBoundsFromLegacyTarget,
  describeSunlightWindow,
  estimateLongitudeDeg,
  evaluateConditions,
  formatComfortRange,
  formatDewPointDifference,
  formatSolarHeatingMetric,
  formatTemp,
  formatTempDifference,
  formatExpectedShiftDisplay,
  fromFahrenheit,
  isNullish,
  normalizeComfortBounds,
  toFahrenheit,
  weatherSolarMultiplier,
} from './engine.mjs';

const STORAGE_KEY = 'should-i-open-the-windows:inputs';

const WEATHER_OPTIONS = new Set([
  'clear',
  'partly-cloudy',
  'cloudy',
  'rainy',
]);

const elements = {
  unitInputs: document.querySelectorAll('input[name="unit"]'),
  unitLabels: document.querySelectorAll('.unit-label[data-unit=\'temp\']'),
  indoorTemp: document.getElementById('indoor-temp'),
  indoorHumidity: document.getElementById('indoor-humidity'),
  outdoorTemp: document.getElementById('outdoor-temp'),
  outdoorHumidity: document.getElementById('outdoor-humidity'),
  weather: document.getElementById('weather'),
  windy: document.getElementById('windy'),
  windSpeed: document.getElementById('wind-speed'),
  windSpeedField: document.getElementById('wind-speed-field'),
  localDate: document.getElementById('local-date'),
  localTime: document.getElementById('local-time'),
  latitude: document.getElementById('latitude'),
  longitude: document.getElementById('longitude'),
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
  const rawLongitude = elements.longitude?.value?.trim();
  const parsedLongitude = rawLongitude === '' ? null : Number(rawLongitude);
  const localDate = elements.localDate?.value || null;
  const localTimeMinutes = parseLocalTimeMinutes(elements.localTime?.value);
  return {
    latitudeDeg: Number.isFinite(latitudeDeg) ? latitudeDeg : DEFAULT_LATITUDE_DEG,
    longitudeDeg: Number.isFinite(parsedLongitude) ? parsedLongitude : null,
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

  if (elements.longitude && !elements.longitude.value) {
    elements.longitude.value = String(Math.round(estimateLongitudeDeg(now) * 10) / 10);
  }

  updateSunlightHint();
}

function updateSunlightHint() {
  if (!elements.sunlightHint) return;
  const { latitudeDeg, longitudeDeg, localDate } = getSolarInputs();
  elements.sunlightHint.textContent = describeSunlightWindow(
    latitudeDeg,
    localDate,
    longitudeDeg,
  );
}

function updateWindSpeedFieldVisibility() {
  if (!elements.windSpeedField || !elements.windy) return;
  elements.windSpeedField.hidden = !elements.windy.checked;
}

function getWindInputs() {
  const windy = Boolean(elements.windy?.checked);
  if (!windy) return { windy: false, windSpeedMph: null };

  const raw = elements.windSpeed?.value?.trim();
  if (!raw) return { windy: true, windSpeedMph: null };

  const speed = Number(raw);
  return {
    windy: true,
    windSpeedMph: Number.isFinite(speed) ? speed : null,
  };
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

  const { latitudeDeg, longitudeDeg, localDate, localTimeMinutes } = getSolarInputs();
  if (latitudeDeg < -60 || latitudeDeg > 70) {
    showValidation('Latitude must be between -60 and 70.');
    return;
  }

  if (
    longitudeDeg !== null &&
    (!Number.isFinite(longitudeDeg) || longitudeDeg < -180 || longitudeDeg > 180)
  ) {
    showValidation('Longitude must be between -180 and 180.');
    return;
  }

  const { windy, windSpeedMph } = getWindInputs();
  if (windy && windSpeedMph !== null && (windSpeedMph < 0 || windSpeedMph > 75)) {
    showValidation('Wind speed must be between 0 and 75 mph.');
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
    windy,
    windSpeedMph,
    unit,
    comfortMinF,
    comfortMaxF,
    latitudeDeg,
    longitudeDeg,
    localDate,
    localTimeMinutes,
  });

  const {
    needs,
    verdict,
    expectedShiftF,
    ventilationShiftCapped,
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
    renderMetric(
      'Expected shift',
      formatExpectedShiftDisplay(expectedShiftF, unit, { capped: ventilationShiftCapped }),
    ),
    renderMetric('Est. indoor temp', formatTemp(result.estimatedIndoorF, unit)),
    renderMetric(
      'Dew point gap',
      formatDewPointDifference(humidityFactor.outdoorDp, humidityFactor.indoorDp, unit),
    ),
    renderMetric('Indoor dew point', formatTemp(humidityFactor.indoorDp, unit)),
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
  const comfortMinF = readComfortSliderF(elements.comfortMin, unit, COMFORT_DEFAULT_MIN_F);
  const comfortMaxF = readComfortSliderF(elements.comfortMax, unit, COMFORT_DEFAULT_MAX_F);
  return normalizeComfortBounds(comfortMinF, comfortMaxF);
}

function enforceComfortSliderOrder(changed) {
  if (!elements.comfortMin || !elements.comfortMax) return;

  const unit = getUnit();
  const range = getComfortSliderRange(unit);
  const minSpan = unit === 'c' ? 1 : COMFORT_MIN_SPAN_F;
  let minVal = Number(elements.comfortMin.value);
  let maxVal = Number(elements.comfortMax.value);

  if (Number.isNaN(minVal)) minVal = Math.round(fromFahrenheit(COMFORT_DEFAULT_MIN_F, unit));
  if (Number.isNaN(maxVal)) maxVal = Math.round(fromFahrenheit(COMFORT_DEFAULT_MAX_F, unit));

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
  const { windy, windSpeedMph } = getWindInputs();
  return {
    unit: getUnit(),
    indoorTemp: elements.indoorTemp.value,
    indoorHumidity: elements.indoorHumidity.value,
    outdoorTemp: elements.outdoorTemp.value,
    outdoorHumidity: elements.outdoorHumidity.value,
    weather: elements.weather.value,
    windy,
    windSpeedMph: windy && windSpeedMph !== null ? windSpeedMph : '',
    comfortMinF: tempLowF,
    comfortMaxF: tempHighF,
    latitudeDeg: Number(elements.latitude?.value) || DEFAULT_LATITUDE_DEG,
    ...(Number.isFinite(Number(elements.longitude?.value))
      ? { longitudeDeg: Number(elements.longitude.value) }
      : {}),
  };
}

function saveFormState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getFormState()));
  }
  catch {
    // Storage unavailable or full -- ignore.
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

    if (typeof state.weather === 'string') {
      if (state.weather === 'windy') {
        elements.weather.value = 'partly-cloudy';
        if (elements.windy) elements.windy.checked = true;
      }
      else if (WEATHER_OPTIONS.has(state.weather)) {
        elements.weather.value = state.weather;
      }
    }

    if (typeof state.windy === 'boolean' && elements.windy) {
      elements.windy.checked = state.windy;
    }

    if (!isNullish(state.windSpeedMph) && elements.windSpeed) {
      elements.windSpeed.value = String(state.windSpeedMph);
    }

    updateWindSpeedFieldVisibility();

    if (typeof state.latitudeDeg === 'number' && Number.isFinite(state.latitudeDeg)) {
      elements.latitude.value = String(state.latitudeDeg);
    }

    if (typeof state.longitudeDeg === 'number' && Number.isFinite(state.longitudeDeg)) {
      elements.longitude.value = String(state.longitudeDeg);
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
    // Corrupt or unreadable saved data -- keep HTML defaults.
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
  elements.windy,
  elements.windSpeed,
  elements.localDate,
  elements.localTime,
  elements.latitude,
  elements.longitude,
];

inputElements.forEach((el) => {
  if (!el) return;
  const refreshSunlightHint =
    el === elements.localDate || el === elements.latitude || el === elements.longitude;
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

if (elements.windy) {
  elements.windy.addEventListener('change', () => {
    updateWindSpeedFieldVisibility();
    onInputChange();
  });
}

loadFormState();
updateWindSpeedFieldVisibility();
initSunlightInputs();
initComfortSliders();
updateUnitLabels();
