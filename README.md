# ADS-B Live for Home Assistant

Home Assistant integration that turns the aircraft your own ADS-B receiver hears, and optionally those adsb.fi's
community network knows, into map feeds, with sensors for the receiver's health.

[![GitHub Release][releases-shield]][releases] [![GitHub Release Date][release-date-shield]][releases] [![HACS][hacs-shield]][hacs] [![License][license-shield]](LICENSE)

<img src="https://raw.githubusercontent.com/jesmak/adsb_live/main/docs/images/dashboard-light.png#gh-light-mode-only" width="1280" alt="A dashboard around Tampere, with a map of ten aircraft drawn as silhouettes in their altitude's colours, with their trails, a legend of the altitudes, the list beside it with an airliner on approach opened to its details, the nearest aircraft as a tile, and the receiver's state on the receiver card with its day of aircraft tracked">
<img src="https://raw.githubusercontent.com/jesmak/adsb_live/main/docs/images/dashboard-dark.png#gh-dark-mode-only" width="1280" alt="A dashboard around Tampere, with a map of ten aircraft drawn as silhouettes in their altitude's colours, with their trails, a legend of the altitudes, the list beside it with an airliner on approach opened to its details, the nearest aircraft as a tile, and the receiver's state on the receiver card with its day of aircraft tracked">

The aircraft in the picture are made up.

## What is it?

A custom component for anyone who runs an ADS-B receiver with [readsb](https://github.com/wiedehopf/readsb), usually
behind [tar1090](https://github.com/wiedehopf/tar1090), for example in
[ultrafeeder](https://github.com/sdr-enthusiasts/docker-adsb-ultrafeeder) or on a Raspberry Pi. It reads the
aircraft straight from the receiver on your own network, with no account, key or cloud service, and turns them into
**map feeds**: a sensor per feed, holding every aircraft in it as GeoJSON, with the nearest aircraft and an event
entity for emergencies, military aircraft and aircraft low overhead.

Show the feeds on a map with [map-feed-card](https://github.com/jesmak/map-feed-card), which draws each aircraft as the
silhouette of its kind (1.1.0 or newer, the turboprop 1.2.0), heading the way it flies, with its trail, and shows its
details beside the map or in a list, with its route and a photo when it is opened. The feed format is documented in
[map-feed-format.md](https://github.com/jesmak/map-feed-card/blob/main/docs/map-feed-format.md). The receiver's own
health has a card of its own, the [receiver card](#receiver-card), which comes with the integration.

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

Add a feed from the integration page with **Add aircraft feed**. Each feed is a map feed sensor, a nearest aircraft
sensor and an event entity, named after the feed.

| Setting                             | Type    | Description                                                                                                                                                                                         | Default                             |
| ----------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Name                                | text    | The name its sensors and event entity are named after.                                                                                                                                              |                                     |
| Area                                | circle  | Aircraft inside the circle are in the feed.                                                                                                                                                         | 100 km around the receiver, or home |
| Add aircraft from adsb.fi           | on/off  | Adds the aircraft adsb.fi knows in the area that your receiver doesn't hear. The circle's radius can then be at most 461 km. See [Data](#data).                                                     | Off                                 |
| Update interval                     | seconds | How often the feed is updated, from every 15 seconds to every 600.                                                                                                                                  | 15                                  |
| Trail length                        | minutes | How far back each aircraft's trail goes, up to 30 minutes. 0 leaves trails out.                                                                                                                     | 5                                   |
| Colour by altitude                  | on/off  | Each aircraft and its trail in its altitude's colour, on the scale tar1090 uses, with a legend on the map. Off, map-feed-card colours them by type of aircraft, such as light, heavy or helicopter. | On                                  |
| Aircraft overhead, radius           | km      | An aircraft in the air this near the area's centre, and below the next setting's altitude, fires the feed's overhead event. 0 turns it off.                                                         | 5                                   |
| Aircraft overhead, maximum altitude | m or ft | The altitude an aircraft must be below for the overhead event, in the receiver's altitude unit.                                                                                                     | 1 500 m or 5 000 ft                 |

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
| Aircraft tracked         |       | Aircraft the receiver currently hears, with or without a position                                   |
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
military aircraft get a notice in the details. The kinds are `air.light`, `air.small`, `air.large`, `air.turboprop`,
`air.heavy`, `air.high_performance`, `air.rotorcraft`, `air.glider`, `air.balloon`, `air.drone` and `air.other`. A
category that names a kind of aircraft, fast and agile (A6), rotorcraft (A7), glider (B1), balloon (B2) or drone (B6),
gives the kind. Otherwise an aircraft's kind comes from its type, in the table of aircraft types tar1090 serves on the
receiver, as the weight bands of A1 to A5 say nothing of the engines. An ATR transmits A2 like a regional jet. A
helicopter, gyrocopter or tiltrotor is a rotorcraft, a balloon or airship a balloon, a drone a drone, a glider a glider,
and an ultralight or paraglider light. Otherwise a heavy wake category is heavy, a medium one large for jets, turboprop
for turboprops and small for others, and a light one light. An aircraft whose type the table doesn't know, as without
tar1090, takes the kind of the category it transmits, and one that transmits none, or A0 for no information, is
`air.other`. The list can be sorted by distance or altitude.

A position an aircraft could only have reached from its last believable one at more than 2 500 km/h, with 5 km to
spare, is left out, as when a spoofed GPS puts an aircraft hundreds of kilometres off its track. The aircraft then
stays where it last was, with that position's time, and its trail leaves the position out. When adsb.fi has a
believable position for it while your receiver's is left out, adsb.fi's is shown. Once an aircraft's positions have
been left out for at least a minute, or for one update when updates come further apart, it is shown where it is
reported again, however far that is, and its trail starts anew there. That also puts right an aircraft whose first
position was the false one.

Opening an aircraft on the map fetches its route and a photo, which the card shows in its details (see
[Actions](#actions)). Nothing is fetched for an aircraft nobody opens.

With colours by altitude on, each aircraft has a `color` and the feed a `legend` of the ground and seven altitudes
in the receiver's unit, and of the light grey for an unknown altitude while some aircraft has one. Metres from a
kilometre up are written in kilometres there, to keep the legend short. A trail takes its aircraft's colour.

### The nearest aircraft

Every feed has a sensor whose state is the nearest aircraft in the air, by its callsign, or its registration or
address when it sends no callsign, measured as the feed measures distances. Its attributes are its `name`, `hex`
address, `callsign`, `registration`, `type`, `squawk`, `military`, `distance_km`, `altitude` in the receiver's
altitude unit, `heading`, `latitude` and `longitude`, those the aircraft has. It is unknown while no aircraft in the
feed is in the air.

## Events

Every feed has an event entity that fires when an aircraft in it:

| Event type  | When                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `emergency` | squawks an emergency code, 7500 (hijack), 7600 (radio failure) or 7700                         |
| `military`  | is flagged military in the aircraft database                                                   |
| `overhead`  | is in the air within the overhead radius of the area's centre, and below the overhead altitude |

The event's attributes are those of the nearest aircraft sensor, for the aircraft that fired it. Each type fires once
for an aircraft while it stays in that state, and again only after it has been out of it, or out of the feed, for 10
minutes, or for two updates when the feed updates less often than every 5 minutes. Restarting Home Assistant or
reloading the receiver, which any change to it or its feeds does, starts afresh, so an aircraft already in a state
fires again.

## Actions

### `adsb_live.get_aircraft_details`

Returns an aircraft's route and photo as map feed detail rows, `{"details": [rows]}`. Each aircraft in a feed names
this action as its detail action, so map-feed-card calls it when the aircraft is opened.

| Field  | Description                                                           |
| ------ | --------------------------------------------------------------------- |
| `feed` | The feed's ID, which the feed gives in each aircraft's detail action. |
| `hex`  | The aircraft's ICAO address, such as `4ca8e1`.                        |

The route is by the aircraft's callsign. A callsign keeps its route for long, but not forever, so the route is left
out when the aircraft is more than 100 km from the way between its airports. The photo is by the aircraft's address,
linked to its page on Planespotters and credited to its photographer. A source that fails or knows nothing leaves its
row out. Both answers are kept for a day.

### `adsb_live.get_receiver_aircraft`

Returns the aircraft the receiver itself has heard in the last minute, with a position or without, and never those only
adsb.fi knows. The [receiver card](#receiver-card) calls it while its list of aircraft is open.

| Field    | Description            |
| -------- | ---------------------- |
| `device` | The receiver's device. |

The answer is `{"aircraft": [...], "altitude_unit": "m"}`, with the altitudes in the receiver's altitude unit. Each
aircraft has its `hex` address and `name`, as the feeds name it, and `heard`, when it was last heard. `position` tells
whether it has a position from the last minute. `registration`, `type` (its ICAO type designator, such as `A320`),
`altitude`, `speed_kmh` (its ground speed) and `rssi` (the signal in dBFS) are there when readsb knows them. An aircraft
on the ground has `on_ground`, true, and no altitude. As in the feeds, what transmits a category of set C is left out.
An answer is kept for 5 seconds, so dashboards open side by side read the receiver once.

## Receiver card

<p>
<img src="https://raw.githubusercontent.com/jesmak/adsb_live/main/docs/images/receiver-full-light.png#gh-light-mode-only" width="400" alt="A receiver hearing 412.6 messages a second, tracking 9 aircraft, 7 of them with a position, with a range of 214 km, a curve of the last day that dips at night, its signal well above the noise, and Flightradar24 connected with 7 aircraft">
<img src="https://raw.githubusercontent.com/jesmak/adsb_live/main/docs/images/receiver-full-dark.png#gh-dark-mode-only" width="400" alt="A receiver hearing 412.6 messages a second, tracking 9 aircraft, 7 of them with a position, with a range of 214 km, a curve of the last day that dips at night, its signal well above the noise, and Flightradar24 connected with 7 aircraft">
<img src="https://raw.githubusercontent.com/jesmak/adsb_live/main/docs/images/receiver-compact-light.png#gh-light-mode-only" width="400" alt="The same receiver on one row, receiving, with 9 aircraft tracked, 7 with a position, 412.6 messages a second and a small curve of the last day">
<img src="https://raw.githubusercontent.com/jesmak/adsb_live/main/docs/images/receiver-compact-dark.png#gh-dark-mode-only" width="400" alt="The same receiver on one row, receiving, with 9 aircraft tracked, 7 with a position, 412.6 messages a second and a small curve of the last day">
</p>

The integration comes with a dashboard card for a receiver's health. You pick the receiver, and the card finds its
sensors by itself. The aircraft themselves are drawn on a map by map-feed-card. This card is about the antenna.

An antenna that hears nothing looks the same as an empty sky, so the card puts the numbers that tell them apart in one
place: messages and positions coming in, the aircraft tracked with and without a position, the longest range of the
last quarter of an hour, and how far the signal rises above the noise. A curve of the aircraft tracked over the last day
shows whether a quiet moment is the time of day or something new. A list of the aircraft the receiver hears opens under
it.

Most receivers also feed Flightradar24 or another network through a feeder of its own, such as fr24feed. Its status can
be added as rows under the receiver, from whatever entities you have for it.

The compact layout puts the receiver on one row with a small curve, for a corner of another view.

The integration serves the card itself and adds it to the dashboards' resources when it starts, so the card is always
the integration's own version. With the resources set in YAML (`resource_mode: yaml`), it can't add or update
itself, and the log says which line to add, change or remove.

### Card options

| Name         | Type    | Description                                                                                           | Default  |
| ------------ | ------- | ----------------------------------------------------------------------------------------------------- | -------- |
| `type`       | string  | `custom:adsb-receiver-card`                                                                           | required |
| `device`     | string  | The receiver's device                                                                                 | required |
| `name`       | string  | Replaces the receiver's name                                                                          |          |
| `layout`     | string  | `full`, or `compact` for one row                                                                      | `full`   |
| `feeders`    | list    | Other feeders' status as rows under the receiver, in `full` only                                      |          |
| `list_open`  | boolean | Whether the list of aircraft heard is open when the card is shown                                     | `false`  |
| `max_height` | number  | The most the card grows to, in pixels, with only the list of aircraft scrolling (see [Sizes](#sizes)) |          |

Each item of `feeders` has these keys:

| Name     | Type   | Description                                                                                                                                                                                         |
| -------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity` | string | Whether the feeder is up. Its state is shown, with a green dot when it is on or connected, red when it is off or disconnected. A problem binary sensor reads the other way round, red when it is on |
| `name`   | string | Replaces the entity's name                                                                                                                                                                          |
| `detail` | string | A second entity whose state is shown after the first, such as the aircraft the feeder reports                                                                                                       |

Everything can be set in the card's visual editor, where the device picker offers only receivers.

### What the card shows

- **The status.** Receiving, in green, while positions come in. Quiet, in grey, when none do. That is usually an empty
  sky, and an aircraft heard without a position counts as quiet too, as it may simply not send one. Unavailable, in
  red, when the positions sensor is unavailable or disabled, as it is when the integration can't reach readsb. The
  numbers, the curve, the meter and the list of aircraft are then left out.
- **Messages per second and positions per minute** under the status, and the receiver's readsb version.
- **The aircraft tracked**, with a position or without, how many of them have a position, and the longest range in the
  last 15 minutes. Clicking a number opens its sensor.
- **The curve** of aircraft tracked over the last 24 hours, from Home Assistant's long-term statistics, each hour's
  mean with the present value at the end. The peak under it is the most tracked at once. A curve's top is never below
  4, so a sky of one aircraft doesn't look as full as a busy one. A receiver added in the last hour has only the
  present value, shown as a dot at the end.
- **Signal and noise** on a meter from −50 to 0 dBFS, the gap between them shaded. A signal close to the noise means
  the antenna hears little. After a minute without messages the signal is unknown and only the noise is shown. A
  receiver that gets its messages over the network rather than from a radio of its own has neither, and no meter.
- **The aircraft heard**, a list folded under the meter. It holds the aircraft the receiver itself has heard in the last
  minute, never those only adsb.fi adds to a map, heard last first. Each row has the aircraft's callsign, or its
  registration or address, and type, its altitude, its ground speed, how long ago it was heard, and its signal on the
  meter's scale. An icon after the type says whether its position is known, and one without a position is dimmed. The
  list is read with [`adsb_live.get_receiver_aircraft`](#adsb_liveget_receiver_aircraft) every 10 seconds, and only
  while it is open.
- **The feeders**, a row each.

<img src="https://raw.githubusercontent.com/jesmak/adsb_live/main/docs/images/receiver-list-light.png#gh-light-mode-only" width="410" alt="The receiver with its list of aircraft heard open: nine aircraft, heard last first, each with its callsign or registration, type, ground speed, how long ago it was heard, altitude and signal, the two without a position dimmed">
<img src="https://raw.githubusercontent.com/jesmak/adsb_live/main/docs/images/receiver-list-dark.png#gh-dark-mode-only" width="410" alt="The receiver with its list of aircraft heard open: nine aircraft, heard last first, each with its callsign or registration, type, ground speed, how long ago it was heard, altitude and signal, the two without a position dimmed">

In the compact layout the row shows the status, the aircraft tracked, those with a position and the messages per
second, with the curve on the right. Clicking it opens the aircraft tracked sensor. It has no list of aircraft.

### Sizes

In a sections view the card takes a whole section by default and can be made as narrow as half of one. On a narrow
card the readsb version goes under the rates, and a label too long for its column wraps. In the compact layout the
curve is left out below 280 px, so the texts keep their room.

An open list of aircraft makes the card as tall as the list. With `max_height` the card grows to that many pixels at
most and only the list scrolls inside it. In a sections view, rows set to a number give the card its height instead,
and the list scrolls inside that.

<img src="https://raw.githubusercontent.com/jesmak/adsb_live/main/docs/images/receiver-quiet-narrow-light.png#gh-light-mode-only" width="260" alt="A quiet receiver on a card half a section wide, tracking one aircraft without a position, its version under the rates and its range label on two lines">
<img src="https://raw.githubusercontent.com/jesmak/adsb_live/main/docs/images/receiver-quiet-narrow-dark.png#gh-dark-mode-only" width="260" alt="A quiet receiver on a card half a section wide, tracking one aircraft without a position, its version under the rates and its range label on two lines">

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

A notice when an aircraft in the feed squawks an emergency. An update can bring several events at once, so an
automation whose actions take a while, such as a notification to a phone, runs queued to handle each of them:

```yaml
mode: queued
triggers:
    - trigger: event.received
      target:
          entity_id: event.aircraft_near_tampere_aircraft_events
      options:
          event_type:
              - emergency
actions:
    - action: persistent_notification.create
      data:
          title: Emergency squawk
          message: >-
              {{ trigger.to_state.attributes.name }} squawks {{ trigger.to_state.attributes.squawk }},
              {{ trigger.to_state.attributes.distance_km }} km away.
```

The receiver card with Flightradar24 as a row under it. fr24feed's own status page, `monitor.json` on port 8754, can be
read into Home Assistant with a REST sensor, and its `feed_status` turned into a connectivity binary sensor:

```yaml
type: custom:adsb-receiver-card
device: 0123456789abcdef0123456789abcdef
feeders:
    - entity: binary_sensor.fr24feed_link
      name: Flightradar24
      detail: sensor.fr24feed_reported_aircraft
```

The receiver on one row, for a corner of another view:

```yaml
type: custom:adsb-receiver-card
device: 0123456789abcdef0123456789abcdef
layout: compact
```

Device ids are easiest to pick in the card's visual editor.

## Upgrading from the separate ADS-B receiver card

The receiver card used to be a repository of its own, ADS-B receiver card. It now comes with the integration, and the
separate repository has been removed. If you installed it, remove it in HACS, and check that its resource
(`/hacsfiles/adsb-receiver-card/…`) is gone from Settings › Dashboards › Resources. Until it is, the log warns about it
at every start, the card picker may list the card twice, and the browser's console may show an error from the separate
card. Your dashboards need no changes, as the card's type stays `custom:adsb-receiver-card`.

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

The routes come from [Virtual Radar Server](https://www.virtualradarserver.co.uk/)'s standing data, which
[adsb.lol](https://adsb.lol/) publishes under [CC0](https://github.com/adsblol/vrs-standing-data). The photos come
from [Planespotters](https://www.planespotters.net/). Under its terms each photo is credited to its photographer and,
shown large, links to its page there, its answers are kept for a day at most, and the picture is loaded by the browser
that shows it, straight from Planespotters, never stored or passed on by the integration. The requests carry the same
User-Agent as adsb.fi's, and the photo's request carries the aircraft's address.

The receiver card shows the integration's sensors, and its curve comes from Home Assistant's own statistics of them. It
fetches nothing from outside Home Assistant.

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

The receiver card's texts are in `frontend/src/localize/languages/`, one JSON file per language. The card finds a new
file by itself and uses it when Home Assistant is set to that language. A text left out falls back to English. A
feeder's state comes from Home Assistant's own translations.

## Development

Requires Python 3.14.

```
python3.14 -m venv .venv
.venv/bin/pip install -r requirements_test.txt
.venv/bin/pytest
.venv/bin/ruff check .
.venv/bin/ruff format --check .
```

The receiver card is in `frontend/` and requires Node 22.13 or newer:

```
cd frontend
npm install
npm run check
```

`npm run check` typechecks, lints, checks formatting, runs the tests and builds
`custom_components/adsb_live/www/adsb-receiver-card.js`, which is the file the integration serves and is committed to
the repository. The card carries the integration's version from `manifest.json`. To have git refuse a commit whose
built card doesn't match `frontend/`, run `git config core.hooksPath .githooks` once.

| Path                                | What it contains                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `__init__.py`                       | Setup: the receiver and one coordinator per feed                                                                       |
| `config_flow.py`                    | The receiver and feed forms                                                                                            |
| `coordinator.py`                    | Fetching the statistics and the feeds, and the receiver's aircraft for its list                                        |
| `sensor.py`                         | The health sensors, feed sensors and nearest aircraft                                                                  |
| `event.py`                          | The feeds' event entities                                                                                              |
| `services.py`                       | The actions: an aircraft's route and photo, and the receiver's aircraft for its list                                   |
| `aircraft.py`                       | Reading readsb's JSON, trails and building feed items                                                                  |
| `colors.py`                         | Colours by altitude and the feed's legend                                                                              |
| `health.py`                         | The health sensors' values from readsb's statistics                                                                    |
| `geo.py`                            | Areas, distances, trail simplification and unit conversions                                                            |
| `api.py`                            | The receiver's HTTP client, adsb.fi's, which every feed shares for its request spacing, and the route and photo client |
| `texts.py`, `texts/<language>.json` | Texts written into feeds                                                                                               |
| `translations/<language>.json`      | Home Assistant UI texts                                                                                                |
| `card.py`, `www/`                   | Serving the receiver card and adding it to the dashboards' resources                                                   |
| `frontend/`                         | The receiver card's source, tests and build                                                                            |
| `docs/screenshots.json`             | The made-up data the README's screenshots are taken from                                                               |

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
