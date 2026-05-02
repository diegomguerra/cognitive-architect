# Migrating QRingPlugin to use RingParsers package

This package isolates BLE packet parsing from BLE I/O. The legacy
`QRingPlugin.swift` (1655 lines) mixes both, which is what produced the
cross-vendor parser leaks (e.g. Colmi HR-history parser eating JStyle ack
packets and emitting HR=242).

## State as of 2026-05-02

- ✅ Package compiles, 13/13 tests green (`swift test` from this directory)
- ✅ Cirurgical gates already shipping in `QRingPlugin.swift` — no garbage in DB
- ⏳ Plugin still has all parsers in-file; migration to the package is the
  next step

## Step 1 (Xcode UI — 30 seconds, requires user)

The package needs to be linked to the `App` target in `App.xcodeproj`.
Editing `project.pbxproj` by script is too risky (sensitive format).

1. Open `cognitive-architect/ios/App/App.xcworkspace` in Xcode.
2. Select the `App` project in the Navigator → `App` target → `General` tab.
3. Scroll to `Frameworks, Libraries, and Embedded Content`.
4. Click `+` → `Add Other...` → `Add Package Dependency...`
5. Click `Add Local...`
6. Navigate to `cognitive-architect/ios/Packages/RingParsers`, select the
   folder, click `Add Package`.
7. In the product picker, check `RingParsers`, target = `App`. Click `Add`.
8. Build (⌘B) — should compile clean.
9. Commit the resulting `project.pbxproj` change with message:
   `chore(ios): link RingParsers SPM package to App target`

## Step 2 (Code migration — Claude can do this once Step 1 lands)

Once `import RingParsers` works in `QRingPlugin.swift`, ~600 lines of in-file
parser code (`parseRealtime`, `parseHrHistory`, `parseSpo2History`,
`parseHrvHistory`, `parseStressHistory`, `parseTemperatureV2`) are deleted
and replaced by `dispatcher.parser.parse(bytes:channel:nowMs:)`. The plugin
becomes ~400 lines of pure BLE I/O + JS bridge.

The translation layer (Sample → NSDictionary for Capacitor JS) lives in
`QRingPlugin.swift` only — it stays vendor-agnostic.

## Step 3 (Add new fixture sources)

Each tester session that exposes new ring behavior:

1. Pull their `debug_raw` rows from `biomarker_samples`:
   ```sql
   select payload_json->>'channel' as channel,
          payload_json->>'raw' as raw_hex, ts
   from biomarker_samples
   where user_id = '<UUID>' and source = 'qring_ble' and type = 'debug_raw'
     and ts > '<session_start>' and ts < '<session_end>'
   order by ts asc;
   ```
2. Save as `Tests/RingParsersTests/Fixtures/<Vendor>/<user>_<scenario>_<date>.json`
   (see existing fixtures for shape).
3. Define `expected` constraints (min_count, value_range, all_mode, etc.).
4. Add a `test_fixture_<name>` to `<Vendor>ParserTests.swift`.
5. `swift test` — must be green.

## Step 4 (Vendor raw audit hookup, optional but recommended)

The `vendors_raw.colmi_packets` and `vendors_raw.jstyle_packets` Supabase
tables already exist (deployed 2026-05-02). The plugin should dual-write:
each notify packet → `biomarker_samples` (existing) AND `vendors_raw.<vendor>_packets`
(new). This gives "for any HR value in the DB, show me the bytes that
produced it" as a deterministic answer — currently we lose that after
~7 days when `debug_raw` rolls.

## Why this matters

The package + fixtures are the **regression suite that breaks the cycle**.
Every release iteration before today was "ship and pray to Lídia/Diego".
After Step 2, every release runs `swift test` against captured fixtures
in <10s. A change that regresses any historical session = CI red = release
blocked. That's the structural fix that makes "every update breaks something"
stop happening.
