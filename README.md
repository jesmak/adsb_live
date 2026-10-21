# ADS-B Live for Home Assistant

Home Assistant integration that turns the aircraft your own ADS-B receiver hears, and optionally those adsb.fi's
community network knows, into map feeds, with sensors for the receiver's health.

[![GitHub Release][releases-shield]][releases] [![GitHub Release Date][release-date-shield]][releases] [![HACS][hacs-shield]][hacs] [![License][license-shield]](LICENSE)

## What is it?

A custom component for anyone who runs an ADS-B receiver with [readsb](https://github.com/wiedehopf/readsb), usually
behind [tar1090](https://github.com/wiedehopf/tar1090), for example in
[ultrafeeder](https://github.com/sdr-enthusiasts/docker-adsb-ultrafeeder) or on a Raspberry Pi. It reads the
aircraft straight from the receiver on your own network, with no account, key or cloud service, and turns them into
**map feeds**: one sensor per feed, holding every aircraft in it as GeoJSON.

Show the feeds on a map with [map-feed-card](https://github.com/jesmak/map-feed-card), which draws each aircraft
heading the way it flies, with its trail, and shows its details beside the map or in a list. The feed format is
documented in [map-feed-format.md](https://github.com/jesmak/map-feed-card/blob/main/docs/map-feed-format.md).

A receiver hears only what its antenna can see. A feed can add the aircraft [adsb.fi](https://adsb.fi/) knows around
the same area, from the receivers of its community, so the map shows the traffic your own antenna misses.

## Installation

### With HACS

1. Add this repository to HACS custom repositories with type **Integration**
2. Search for ADS-B Live in HACS and download it
3. Restart Home Assistant
4. Add the integration in Settings › Devices & services, then add feeds from its page

### Manual

1. Download the source code from the latest release
2. Copy the `custom_components/adsb_live` folder to your Home Assistant installation's `config/custom_components`
   folder
3. Restart Home Assistant
4. Add the integration in Settings › Devices & services, then add feeds from its page

## Settings

### Receiver

Each receiver is set up once. Several receivers can be added, each as its own entry.

| Setting       | Type | Description                                                                                                                                                              | Default                                                        |
| ------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Name          | text | The receiver's name, which its sensors are named after.                                                                                                                  | `ADS-B`                                                        |
| Address       | URL  | The address of tar1090, or of readsb's own web server, such as `http://192.168.1.20:8080` or `http://raspberrypi.local/tar1090`. Its `data/` folder has `aircraft.json`. |                                                                |
| Language      | list | Language of the texts the feeds show on the map, such as an aircraft's details, Finnish or English.                                                                      | Home Assistant's language when it is one of them, else English |
| Altitude unit | list | Altitudes in metres and vertical rates in m/s, or feet and ft/min as in aviation.                                                                                        | Metres, or feet when Home Assistant uses US customary units    |

A receiver behind a login is added with the login in its address, as in `http://user:password@192.168.1.20:8080`.
The login is left out of the log and of the device's link. An address copied from the map with an aircraft selected
works too, as the part after `?` is left out.

The address, language and altitude unit can be changed later with **Reconfigure** on the integration page. Only a
new address is checked, so the language and unit can be changed while the receiver is off.

### Aircraft feed

Add a feed from the integration page with **Add aircraft feed**. Each feed is one map feed sensor, named after the
feed.

| Setting                   | Type    | Description                                                                                                                                                                                         | Default                             |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Name                      | text    | Also the name of the feed's sensor.                                                                                                                                                                 |                                     |
| Area                      | circle  | Aircraft inside the circle are in the feed.                                                                                                                                                         | 100 km around the receiver, or home |
| Add aircraft from adsb.fi | on/off  | Adds the aircraft adsb.fi knows in the area that your receiver doesn't hear. The circle's radius can then be at most 461 km. See [Data](#data).                                                     | Off                                 |
| Update interval           | seconds | How often the feed is updated, from every 15 seconds to every 600.                                                                                                                                  | 15                                  |
| Trail length              | minutes | How far back each aircraft's trail goes, up to 30 minutes. 0 leaves trails out.                                                                                                                     | 5                                   |
| Colour by altitude        | on/off  | Each aircraft and its trail in its altitude's colour, on the scale tar1090 uses, with a legend on the map. Off, map-feed-card colours them by type of aircraft, such as light, heavy or helicopter. | On                                  |

An aircraft is in a feed while its position is less than a minute old. What transmits a category of set C is left
out: surface vehicles and obstacles, fixed or tethered such as a balloon, and C0 without a subcategory.

When readsb stops, its web server goes on serving the last aircraft and statistics it wrote. A feed becomes
unavailable when the aircraft were last written more than 2 minutes ago, and the health sensors when the statistics
were more than 3 minutes ago. A stopped receiver's last aircraft go at the feed's first update more than two minutes
after it stopped, at most about two and a quarter minutes at the default interval. The margins allow for the
receiver's clock to differ a little from Home Assistant's.

## Sensors

### The receiver's health

Every receiver gets these sensors, read from readsb's statistics once a minute.

| Sensor                   | Unit  | Description                                                                                         |
| ------------------------ | ----- | --------------------------------------------------------------------------------------------------- |
| Aircraft with a position |       | Aircraft the receiver currently has a position for                                                  |
| Messages per second      | msg/s | Valid messages decoded in the last minute                                                           |
| Positions per minute     | /min  | Positions decoded in the last minute                                                                |
| Longest range            | km    | The farthest position in the last 15 minutes. Needs the receiver's own position to be set in readsb |
| Signal                   | dBFS  | Mean signal of the messages in the last minute                                                      |
| Noise                    | dBFS  | Noise floor in the last minute                                                                      |

Signal is unknown after a minute in which the receiver decoded no messages, as there was nothing to measure. Signal
and noise both stay unknown for a receiver that gets its messages over the network rather than from its own radio.
Few messages and a signal close to the noise mean the antenna hears little. That may be an empty sky as well as a
fault, so compare with a busier time of day before blaming the antenna.

### Aircraft feeds

A feed's sensor state is the number of aircraft in it. The aircraft are in the `geojson` attribute in the
[map feed format](https://github.com/jesmak/map-feed-card/blob/main/docs/map-feed-format.md), nearest first. Only
the count is recorded in Home Assistant's database.

Each aircraft is named by its callsign, or its registration or address when it sends no callsign. Its subtitle is
its type's name and operator from the aircraft database. Its details show:

- altitude, or "on the ground"
- vertical rate
- squawk, and registration and type when the aircraft database has them
- distance from the receiver, or from the area's centre when the receiver's position isn't set
- the position's source, which is ADS-B, MLAT, TIS-B, other or adsb.fi

Altitudes and vertical rates are in the receiver's altitude unit. An emergency squawk (7500, 7600 or 7700) and a
military aircraft get a notice in the details. The kinds are `air.light`, `air.small`, `air.large`, `air.heavy`,
`air.high_performance`, `air.rotorcraft`, `air.glider`, `air.balloon`, `air.drone` and `air.other`, from the category
the aircraft transmits. The list can be sorted by distance or altitude.

With colours by altitude on, each aircraft has a `color` and the feed a `legend` of the ground and seven altitudes
in the receiver's unit, and of the light grey for an unknown altitude while some aircraft has one. Metres from a
kilometre up are written in kilometres there, to keep the legend short. A trail takes its aircraft's colour.

## Examples

Aircraft on a map with their list beside it, nearest first:

```yaml
type: custom:map-feed-card
title: Aircraft
list: true
entities:
    - entity: sensor.aircraft_near_tampere
      show_area: true
      labels: true
```

A notice when the receiver has heard nothing for a while, or has stopped, which makes its sensors unavailable:

```yaml
triggers:
    - trigger: numeric_state
      entity_id: sensor.ads_b_messages_per_second
      below: 1
      for:
          minutes: 30
    - trigger: state
      entity_id: sensor.ads_b_messages_per_second
      to: unavailable
      for:
          minutes: 30
actions:
    - action: persistent_notification.create
      data:
          title: ADS-B
          message: The receiver has decoded almost nothing, or not answered, for 30 minutes.
```

## Data

The receiver's data is your own. The registrations, types, operators and military flags come from the aircraft
database your receiver uses, if it has one turned on (`TAR1090_ENABLE_AC_DB` in ultrafeeder).

[adsb.fi](https://adsb.fi/)'s open data is for personal, non-commercial use only, under
[its terms](https://github.com/adsbfi/opendata). A feed that uses it credits adsb.fi on the map, with a link to its site. Its requests carry a
User-Agent with the integration's name, version and the address of this repository. It contains no personal
information. The area's centre is sent rounded to about a kilometre, so the query doesn't tell adsb.fi where your home
is, and the query reaches one nautical mile beyond the area to make up for it.

adsb.fi allows one request a second from an address, and counts the failed ones too. Requests to it are kept 1.1
seconds apart across every feed of every receiver, so each update waits its turn, and with many feeds the last of
them updates a few seconds late. When adsb.fi fails or doesn't answer within 5 seconds, a feed shows what your own
receiver hears. The log says so once for each feed, without the query's address, and again when it answers.
Restarting Home Assistant, or reloading a receiver, which any change to it or its feeds does, starts that receiver's
feeds afresh, so they say it again if adsb.fi is still failing.

Keep areas to what a map shows at once. A feed of a hundred aircraft with trails is several tens of kilobytes, which
Home Assistant sends to every open dashboard on each update.

## Translating

The integration's own texts are in two places. `translations/<language>.json` has Home Assistant's UI, and
`texts/<language>.json` the texts written into feeds, with the language's thousands and decimal separators. To add a
language for feeds, copy `texts/en.json` to the new language's code, translate the values, set the separators, add
the code to `LANGUAGES` in `const.py`, and add the language to `selector.language.options` in every
`translations/<language>.json`. For Home Assistant's UI in the same language, copy `translations/en.json` too. The
tests check that every language has the same keys and placeholders as English, and that `LANGUAGES`, the language
selector and `texts/` list the same languages. Callsigns, registrations, types and operators come from the
receiver as they are.

## Development

Requires Python 3.14.

```
python3.14 -m venv .venv
.venv/bin/pip install -r requirements_test.txt
.venv/bin/pytest
.venv/bin/ruff check .
.venv/bin/ruff format --check .
```

| Path                                | What it contains                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `__init__.py`                       | Setup: the receiver and one coordinator per feed                                           |
| `config_flow.py`                    | The receiver and feed forms                                                                |
| `coordinator.py`                    | Fetching the statistics and the feeds                                                      |
| `sensor.py`                         | The health sensors and feed sensors                                                        |
| `aircraft.py`                       | Reading readsb's JSON, trails and building feed items                                      |
| `colors.py`                         | Colours by altitude and the feed's legend                                                  |
| `health.py`                         | The health sensors' values from readsb's statistics                                        |
| `geo.py`                            | Areas, distances, trail simplification and unit conversions                                |
| `api.py`                            | The receiver's HTTP client, and adsb.fi's, which every feed shares for its request spacing |
| `texts.py`, `texts/<language>.json` | Texts written into feeds                                                                   |
| `translations/<language>.json`      | Home Assistant UI texts                                                                    |

## Support

Hey dude! Help me out for a couple of :beers: or a :coffee:!

[![coffee](https://www.buymeacoffee.com/assets/img/custom_images/black_img.png)](https://www.buymeacoffee.com/jesmak)

## Thanks

The colours by altitude follow the scale of [tar1090](https://github.com/wiedehopf/tar1090) by wiedehopf, the map
most ADS-B receivers show, and the aircraft come from [readsb](https://github.com/wiedehopf/readsb), which wiedehopf
maintains.

## License

MIT, see [LICENSE](LICENSE).

[releases-shield]: https://img.shields.io/github/release/jesmak/adsb_live.svg?style=for-the-badge
[release-date-shield]: https://img.shields.io/github/release-date/jesmak/adsb_live?style=for-the-badge
[releases]: https://github.com/jesmak/adsb_live/releases
[hacs-shield]: https://img.shields.io/badge/HACS-Custom-orange.svg?style=for-the-badge
[hacs]: https://hacs.xyz/docs/faq/custom_repositories/
[license-shield]: https://img.shields.io/github/license/jesmak/adsb_live.svg?style=for-the-badge
