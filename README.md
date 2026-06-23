# Should I open the windows?

<https://ctcpip.github.io/should-i-open-the-windows>

A web app that compares indoor and outdoor conditions and gives a nuanced recommendation about natural ventilation -- not just yes or no.

**The question:** given your current indoor comfort, outdoor weather, and the time of day, is it worth opening the windows?

Recommendations assume **heating and cooling are off**. Running HVAC while ventilating wastes energy and fights the outdoor air.

## What you enter

### Home information

| Input                                | Purpose                                               |
| ------------------------------------ | ----------------------------------------------------- |
| **Latitude / longitude**             | Sunrise, sunset, and solar heating                    |
| **Home type, stories, sun exposure** | How quickly the building heats and how well air mixes |
| **Comfortable temperature range**    | Your acceptable indoor band                           |

### Your conditions

| Input                                | Purpose                                                    |
| ------------------------------------ | ---------------------------------------------------------- |
| **Date, time**                       | Solar intensity and time-of-day effects                    |
| **Indoor / outdoor temp & humidity** | Core comparison (°F or °C)                                 |
| **Sky conditions**                   | Clear, partly cloudy, cloudy, or rainy                     |
| **Wind**                             | Optional breezy/windy toggle and average wind speed (mph)  |
| **Ventilation**                      | Window opening level and how many floors have open windows |
| **Evaluate**                         | Runs the engine and shows a detailed breakdown             |

## How recommendations work

The engine scores four factors and combines them into a verdict:

- **Temperature** — Uses a partial-shift model: indoor temp at your floor moves partway toward outdoor (20–50% of the gap, capped at ~18°F for the whole home), scaled by window opening, floors open, home type, and wind. Solar load and internal gains (people, appliances) are included in the net shift. Cool/warm scoring respects this net shift, not just the outdoor gap.
- **Humidity** — Dew point comparison. Indoor RH above **~50%** triggers a dryness goal. Scores scale with ventilation effectiveness; results include a **humidity outlook** (slow / gradual / good drying potential).
- **Condensation** — Risk of fogging / water on window glass when warm moist indoor air meets cold outdoor glass.
- **Weather** — Solar heating (time-of-day + sky + sun on building), rain, and wind for air exchange.

Results show **temperature** and **humidity outlooks** at your main floor, plus factor-by-factor explanations.

Verdict levels range from **Strong yes** to **Avoid opening**.

## Caveats

- Heuristics, not physics simulation — useful for everyday decisions, not HVAC design.
- No time-to-equilibrium model; shifts describe direction and rough magnitude if windows stay open.
- Does not account for air quality, pollen, allergies, noise, security, or rain blowing in.
- Solar and sunrise/sunset use the [NOAA solar equations](https://gml.noaa.gov/grad/solcalc/calcdetails.html).
- When in doubt, crack windows briefly instead of opening wide.
