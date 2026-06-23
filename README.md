# Should I open the windows?

<https://ctcpip.github.io/should-i-open-the-windows>

A web app that compares indoor and outdoor conditions and gives a nuanced recommendation about natural ventilation -- not just yes or no.

**The question:** given your current indoor comfort, outdoor weather, and the time of day, is it worth opening the windows?

Recommendations assume **heating and cooling are off**. Running HVAC while ventilating wastes energy and fights the outdoor air.

## What you enter

| Input                                | Purpose                                                   |
| ------------------------------------ | --------------------------------------------------------- |
| **Date, time, latitude, longitude**  | Estimate sunrise/sunset and solar heating on the building |
| **Indoor / outdoor temp & humidity** | Core comparison (°F or °C)                                |
| **Sky conditions**                   | Clear, partly cloudy, cloudy, or rainy                    |
| **Wind**                             | Optional breezy/windy toggle and average wind speed (mph) |
| **Comfort range**                    | Your acceptable indoor temperature band (60-80°F)         |
| **Evaluate**                         | Runs the engine and shows a detailed breakdown            |

Date and time reset to **now** on every page load. Other inputs are saved in `localStorage`.

## How recommendations work

The engine scores four factors and combines them into a verdict:

- **Temperature**
  - Will ventilation help you cool down, warm up, or stay comfortable? Uses a _partial shift_ model: indoor temp moves partway toward outdoor (20-50% of the gap, capped at ~18°F for the whole home).
- **Humidity**
  - Dew point comparison. Indoor RH above **~50%** triggers a dryness goal; high humidity can feel stuffy even when temperature is fine.
- **Condensation**
  - Risk of fogging / water on window glass when warm moist indoor air meets cold outdoor glass.
- **Weather**
  - Solar heating (time-of-day + sky conditions), rain, and optional wind for air exchange.

Verdict levels range from **Strong yes** to **Avoid opening**, with factor-by-factor explanations in the results panel.

## Caveats

- Heuristics, not physics simulation -- useful for everyday decisions, not HVAC design.
- Does not account for air quality, pollen, allergies, noise, security, or rain blowing in.
- Solar and sunrise/sunset use the [NOAA solar equations](https://gml.noaa.gov/grad/solcalc/calcdetails.html).
- When in doubt, crack windows briefly instead of opening wide.
