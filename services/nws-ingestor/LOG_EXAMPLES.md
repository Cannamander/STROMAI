# NWS Ingestor – Log output examples

Output is structured as: **run header** → **one line per state (per alert)** → **run summary**. Each state that has an event gets a line with location details, event type, and ZIP list (sample on line; full when LOG_ZIP_FULL+debug).

---

## Example: LOG_LEVEL=info (default)

Sample run with 5 features fetched, 2 actionable (e.g. Winter Weather Advisory). One **[STATE]** line per state: state, event, area, county, city, zones, geom, zips count, ZIP sample, upsert.

```
AI-STORMS NWS INGEST RUN
  Mode:       once
  Area:       AL,AK,AZ,...,WY
  Fetched:    5 features
  Event types: Winter Weather Advisory=2, Lake Wind Advisory=2, Special Weather Statement=1
  Filters:    allowlist=21, include_watch=false, actionable_kept=2
[STATE] state=NJ | event=Winter Weather Advisory | area=Sussex; Carbon; Monroe | county=— | city=— | zones=NJZ001,PAZ054,PAZ055 | geom=N | zips=42 | 07821,07822,... (42 total) | upsert=updated
[STATE] state=PA | event=Winter Weather Advisory | area=Sussex; Carbon; Monroe | county=— | city=— | zones=NJZ001,PAZ054,PAZ055 | geom=N | zips=42 | 07821,07822,... (42 total) | upsert=updated
[STATE] state=NJ | event=Winter Weather Advisory | area=Western Passaic; Orange; Putnam | county=— | city=— | zones=NJZ002,NYZ067,NYZ068 | geom=N | zips=38 | 07001,07002,... (38 total) | upsert=updated
[STATE] state=NY | event=Winter Weather Advisory | area=Western Passaic; Orange; Putnam | county=— | city=— | zones=NJZ002,NYZ067,NYZ068 | geom=N | zips=38 | 07001,07002,... (38 total) | upsert=updated
—
RUN SUMMARY
  Counters:
    fetched_count:            5
    actionable_kept:          2
    geom_present_count:       0
    total_zips_mapped:        0
    nws_alerts_inserted:      0
    nws_alerts_updated:       2
    impact_inserted:          0
    impact_updated:           2
    lsr_products_fetched:     277
    lsr_entries_parsed:       72
    lsr_entries_with_points:  0
    lsr_matches_inserted:     0
  Timing:
    fetch_nws_ms              1737 ms
    upsert_alerts_ms          610 ms
    zips_ms                   40 ms
    impact_ms                 312 ms
    lsr_ms                    10722 ms
    total_ms                  13428 ms
  Exit:
    success:              true
    errors_count:         0
    rate_limit_retries:   0
```

---

## Example: LOG_LEVEL=debug

Adds `zips_sample` and `zones_sample` under each alert (after its state lines). With `LOG_ZIP_FULL=true`, full ZIP list is printed under each [STATE] line (chunked).

```
AI-STORMS NWS INGEST RUN
  Mode:       once
  Area:       NJ,NY,PA
  Fetched:    5 features
  Event types: Winter Weather Advisory=2, Lake Wind Advisory=2, Special Weather Statement=1
  Filters:    allowlist=21, include_watch=false, actionable_kept=2
[STATE] state=NJ | event=Winter Weather Advisory | area=Sussex; Carbon; Monroe | county=— | city=— | zones=NJZ001,PAZ054,PAZ055 | geom=N | zips=42 | 07821,07822,... (42 total) | upsert=updated
[STATE] state=PA | event=Winter Weather Advisory | area=Sussex; Carbon; Monroe | county=— | city=— | zones=NJZ001,PAZ054,PAZ055 | geom=N | zips=42 | 07821,07822,... (42 total) | upsert=updated
  zips_sample: 07821,07822,... (10 of 42)
  zones_sample: NJZ001,PAZ054,PAZ055 (3 total)
[STATE] state=NJ | event=Winter Weather Advisory | area=Western Passaic; Orange; Putnam | ...
[STATE] state=NY | event=Winter Weather Advisory | area=Western Passaic; Orange; Putnam | ...
  zips_sample: 07001,07002,... (10 of 38)
  zones_sample: NJZ002,NYZ067,NYZ068 (3 total)
—
RUN SUMMARY
  Counters:
    ...
  Timing:
    ...
  Exit:
    success:              true
    errors_count:         0
    rate_limit_retries:   0
```

With **LOG_ZIP_FULL=true** and **LOG_LEVEL=debug** (or trace), the logger prints the full ZIP list for each alert in chunks of 20 per line, up to **LOG_ZIP_FULL_MAX** (default 200).

---

## Example: LOG_LEVEL=trace

Same as debug, plus a **single-line JSON summary** at the end for machine parsing:

```
...
  rate_limit_retries:   0
{"fetched_count":5,"actionable_kept":2,"geom_present_count":0,"total_zips_mapped":80,"nws_alerts_inserted":0,"nws_alerts_updated":2,"impact_inserted":0,"impact_updated":2,"lsr_products_fetched":277,"lsr_entries_parsed":72,"lsr_entries_with_points":0,"lsr_matches_inserted":0,"duration_ms":13428}
```

---

## Poll mode

When starting `npm run nws:poll`, one line is printed, then each cycle uses the same format (header, alert lines, summary) with **Mode: poll** in the header:

```
AI-STORMS NWS INGEST RUN (poll mode, interval 120s)
AI-STORMS NWS INGEST RUN
  Mode:       poll
  Area:       ...
  ...
```
